import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TemplateManifestSchema, type LoadedTemplate } from "../../src/infrastructure/templates/manifest.js";
import {
  buildPlan,
  mergeTemplates,
  renderText,
  selectTemplates
} from "../../src/infrastructure/templates/template-engine.js";
import { FileSystemTemplateSource } from "../../src/infrastructure/templates/template-source.js";

function template(manifest: Record<string, unknown>): LoadedTemplate {
  return {
    manifest: TemplateManifestSchema.parse({ manifestVersion: 1, version: "1.0.0", ...manifest }),
    directory: "/virtual"
  };
}

const base = template({
  id: "base",
  category: "base",
  dependencies: { express: "^5.0.0" },
  env: ["PORT=3000"],
  package: { version: "1.0.0" }
});
const ts = template({
  id: "language/typescript",
  category: "language",
  option: "typescript",
  label: "TypeScript",
  variables: { ext: "ts" },
  scripts: { dev: "tsx" },
  devDependencies: { typescript: "^5" }
});
const pg = template({
  id: "database/postgresql",
  category: "database",
  option: "postgresql",
  label: "PG",
  dependencies: { pg: "^8" },
  env: ["DB_HOST=localhost"]
});

describe("renderText", () => {
  it("substitutes variables, including with inner spaces", () => {
    expect(renderText("a {{x}} b {{ y }}", { x: "1", y: "2" }, "t")).toBe("a 1 b 2");
  });

  it("fails on unknown variables instead of rendering blanks", () => {
    expect(() => renderText("{{missing}}", {}, "t")).toThrowError(
      expect.objectContaining({ code: "TEMPLATE_INVALID" })
    );
  });

  it("leaves text without placeholders untouched", () => {
    expect(renderText("const a = `${b}`; {x}", {}, "t")).toBe("const a = `${b}`; {x}");
  });
});

describe("selectTemplates", () => {
  const all = [base, ts, pg];

  it("always includes base first, then one template per selection", () => {
    expect(selectTemplates(all, { language: "typescript", database: "postgresql" }).map((t) => t.manifest.id)).toEqual([
      "base",
      "language/typescript",
      "database/postgresql"
    ]);
  });

  it("explains missing templates and lists the alternatives", () => {
    expect(() => selectTemplates(all, { language: "ruby" })).toThrowError(
      expect.objectContaining({ code: "TEMPLATE_NOT_FOUND", hint: expect.stringContaining("typescript") })
    );
  });

  it("fails when there is no base template", () => {
    expect(() => selectTemplates([ts], {})).toThrowError(expect.objectContaining({ code: "TEMPLATE_NOT_FOUND" }));
  });
});

describe("mergeTemplates", () => {
  it("combines dependencies, scripts, env and variables", () => {
    const merged = mergeTemplates([base, ts, pg]);
    expect(merged.dependencies).toEqual({ express: "^5.0.0", pg: "^8" });
    expect(merged.devDependencies).toEqual({ typescript: "^5" });
    expect(merged.scripts).toEqual({ dev: "tsx" });
    expect(merged.env).toEqual(["PORT=3000", "DB_HOST=localhost"]);
    expect(merged.variables).toEqual({ ext: "ts" });
  });

  it("de-duplicates identical env lines and identical dependency versions", () => {
    const other = template({
      id: "database/mysql",
      category: "database",
      option: "mysql",
      label: "My",
      dependencies: { express: "^5.0.0" },
      env: ["PORT=3000"]
    });
    const merged = mergeTemplates([base, other]);
    expect(merged.env).toEqual(["PORT=3000"]);
  });

  it("rejects conflicting values for the same key", () => {
    const other = template({
      id: "database/mysql",
      category: "database",
      option: "mysql",
      label: "My",
      dependencies: { express: "^4.0.0" }
    });
    expect(() => mergeTemplates([base, other])).toThrowError(expect.objectContaining({ code: "TEMPLATE_INVALID" }));
  });
});

describe("buildPlan", () => {
  const files: Record<string, string> = { "a.tpl": "name={{projectName}}", "b.tpl": "ext={{ext}}" };
  const withFiles = (t: LoadedTemplate, entries: { from: string; to: string }[]): LoadedTemplate => ({
    ...t,
    manifest: { ...t.manifest, files: entries }
  });
  const read = async (_t: LoadedTemplate, rel: string) => files[rel] ?? "";

  it("renders files, package.json, .env.example and schema.json in memory", async () => {
    const plan = await buildPlan({
      templates: [withFiles(base, [{ from: "a.tpl", to: "src/a.{{ext}}" }]), ts, pg],
      readTemplateFile: read,
      variables: { projectName: "demo" },
      packageName: "demo"
    });
    const byPath = Object.fromEntries(plan.map((file) => [file.path, file.content]));
    expect(byPath["src/a.ts"]).toBe("name=demo");
    expect(JSON.parse(byPath["package.json"]!)).toEqual({
      name: "demo",
      version: "1.0.0",
      scripts: { dev: "tsx" },
      dependencies: { express: "^5.0.0", pg: "^8" },
      devDependencies: { typescript: "^5" }
    });
    expect(byPath[".env.example"]).toBe("PORT=3000\nDB_HOST=localhost\n");
    expect(JSON.parse(byPath["src/generated/schema.json"]!).entities).toEqual([]);
  });

  it("sorts dependency keys for stable output", async () => {
    const plan = await buildPlan({
      templates: [
        base,
        template({
          id: "language/typescript",
          category: "language",
          option: "typescript",
          label: "T",
          variables: { ext: "ts" },
          dependencies: { aaa: "1" }
        })
      ],
      readTemplateFile: read,
      variables: {},
      packageName: "x"
    });
    const pkg = JSON.parse(plan.find((file) => file.path === "package.json")!.content);
    expect(Object.keys(pkg.dependencies)).toEqual(["aaa", "express"]);
  });

  it("rejects two templates writing the same path", async () => {
    const one = withFiles(base, [{ from: "a.tpl", to: "same.txt" }]);
    const two = withFiles(pg, [{ from: "b.tpl", to: "same.txt" }]);
    await expect(
      buildPlan({
        templates: [one, ts, two],
        readTemplateFile: read,
        variables: { projectName: "d" },
        packageName: "d"
      })
    ).rejects.toMatchObject({ code: "TEMPLATE_INVALID" });
  });
});

describe("FileSystemTemplateSource", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-templates-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const write = (relative: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  };
  const manifest = (extra: Record<string, unknown>) =>
    JSON.stringify({ manifestVersion: 1, version: "1.0.0", ...extra });

  it("discovers templates by folder without any registration", async () => {
    write("base/template.json", manifest({ id: "base", category: "base" }));
    write(
      "language/go/template.json",
      manifest({ id: "language/go", category: "language", option: "go", label: "Go" })
    );
    const all = await new FileSystemTemplateSource(root).loadAll();
    expect(all.map((t) => t.manifest.id)).toEqual(["base", "language/go"]);
  });

  it("reports a missing templates directory", async () => {
    await expect(new FileSystemTemplateSource(path.join(root, "nope")).loadAll()).rejects.toMatchObject({
      code: "TEMPLATE_NOT_FOUND"
    });
  });

  it("reports invalid JSON and invalid manifests with the template id", async () => {
    write("base/template.json", "{broken");
    await expect(new FileSystemTemplateSource(root).loadAll()).rejects.toMatchObject({
      code: "TEMPLATE_INVALID",
      message: expect.stringContaining("base")
    });

    write("base/template.json", manifest({ id: "base", category: "base", version: "one" }));
    await expect(new FileSystemTemplateSource(root).loadAll()).rejects.toMatchObject({
      code: "TEMPLATE_INVALID",
      message: expect.stringContaining("version")
    });
  });

  it("rejects an unsupported manifestVersion", async () => {
    write("base/template.json", JSON.stringify({ manifestVersion: 2, id: "base", version: "1.0.0", category: "base" }));
    await expect(new FileSystemTemplateSource(root).loadAll()).rejects.toMatchObject({ code: "TEMPLATE_INVALID" });
  });

  it("rejects an id that does not match the folder", async () => {
    write("base/template.json", manifest({ id: "base", category: "base" }));
    write(
      "language/go/template.json",
      manifest({ id: "language/rust", category: "language", option: "rust", label: "Rust" })
    );
    await expect(new FileSystemTemplateSource(root).loadAll()).rejects.toMatchObject({
      code: "TEMPLATE_INVALID",
      message: expect.stringContaining("does not match")
    });
  });

  it("requires option and label for non-base templates", async () => {
    write("base/template.json", manifest({ id: "base", category: "base" }));
    write("language/go/template.json", manifest({ id: "language/go", category: "language" }));
    await expect(new FileSystemTemplateSource(root).loadAll()).rejects.toMatchObject({ code: "TEMPLATE_INVALID" });
  });

  it("reports a referenced file that does not exist", async () => {
    write(
      "base/template.json",
      manifest({ id: "base", category: "base", files: [{ from: "files/missing.tpl", to: "x" }] })
    );
    await expect(new FileSystemTemplateSource(root).loadAll()).rejects.toMatchObject({
      code: "TEMPLATE_NOT_FOUND",
      message: expect.stringContaining("missing.tpl")
    });
  });

  it("refuses template file references that escape the template folder", async () => {
    write("secret.txt", "top secret");
    write(
      "base/template.json",
      manifest({ id: "base", category: "base", files: [{ from: "../secret.txt", to: "x" }] })
    );
    await expect(new FileSystemTemplateSource(root).loadAll()).rejects.toMatchObject({ code: "UNSAFE_PATH" });
  });

  it("reads template files", async () => {
    write("base/template.json", manifest({ id: "base", category: "base", files: [{ from: "f.tpl", to: "f" }] }));
    write("base/f.tpl", "hello");
    const source = new FileSystemTemplateSource(root);
    const [first] = await source.loadAll();
    expect(await source.readFile(first!, "f.tpl")).toBe("hello");
    await expect(source.readFile(first!, "nope.tpl")).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
  });
});
