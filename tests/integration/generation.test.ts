import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestEnvironment, type TestEnvironment } from "../helpers/context.js";
import { TEST_API_KEY, VALID_SPEC } from "../helpers/fakes.js";

const environments: TestEnvironment[] = [];
const setup = (options: Parameters<typeof createTestEnvironment>[0] = {}) => {
  const env = createTestEnvironment(options);
  environments.push(env);
  return env;
};
afterEach(() => environments.splice(0).forEach((env) => env.cleanup()));

const manifest = (fields: Record<string, unknown>): string =>
  JSON.stringify({ manifestVersion: 1, version: "1.0.0", ...fields });

/** A test environment whose templates come from `files` (relative path -> content) instead of the shipped ones. */
function envWithTemplates(files: Record<string, string>): TestEnvironment {
  const holder = setup();
  const templatesRoot = path.join(holder.root, "templates");
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(templatesRoot, relative)), { recursive: true });
    fs.writeFileSync(path.join(templatesRoot, relative), content);
  }
  const defaults: Record<string, string> = {
    "language/javascript/template.json": manifest({
      id: "language/javascript",
      category: "language",
      option: "javascript",
      label: "JS",
      variables: { ext: "js" }
    }),
    "database/none/template.json": manifest({
      id: "database/none",
      category: "database",
      option: "none",
      label: "None"
    })
  };
  for (const [relative, content] of Object.entries(defaults)) {
    const target = path.join(templatesRoot, relative);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return setup({ templatesRoot });
}

const DRIVERS = { postgresql: "pg", mysql: "mysql2", mongodb: "mongoose", none: undefined } as const;
const ENV_LINES = {
  postgresql: "DB_HOST=localhost",
  mysql: "DB_HOST=localhost",
  mongodb: "MONGO_URI=mongodb://localhost:27017/app",
  none: undefined
} as const;
const FOLDERS = ["controllers", "routes", "models", "services", "middlewares", "config", "validators", "utils"];

const read = (root: string, relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");
const json = (root: string, relative: string) => JSON.parse(read(root, relative));
const walk = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

describe.each(["javascript", "typescript"] as const)("project generation (%s)", (language) => {
  describe.each(Object.keys(DRIVERS) as (keyof typeof DRIVERS)[])("with database %s", (database) => {
    it("writes a complete, self-consistent project", async () => {
      const env = setup();
      const projectPath = path.join(env.cwd, "demo-app");
      const result = await env.ctx.generator.generate({
        options: { projectName: "demo-app", language, database },
        projectPath
      });
      const ext = language === "typescript" ? "ts" : "js";

      expect(result.projectPath).toBe(projectPath);
      expect(result.files).toContain(`src/app.${ext}`);

      const pkg = json(projectPath, "package.json");
      expect(pkg).toMatchObject({ name: "demo-app", version: "1.0.0", private: true, type: "module" });
      expect(pkg.dependencies).toMatchObject({
        express: "^5.0.0",
        cors: "^2.8.5",
        helmet: "^8.0.0",
        dotenv: "^16.4.0"
      });
      const driver = DRIVERS[database];
      for (const other of Object.values(DRIVERS)) {
        if (other) expect(Object.keys(pkg.dependencies).includes(other)).toBe(other === driver);
      }

      if (language === "typescript") {
        expect(pkg.scripts).toMatchObject({
          dev: "tsx watch src/server.ts",
          build: "tsc -p tsconfig.json",
          start: "node dist/server.js"
        });
        expect(pkg.devDependencies).toHaveProperty("typescript");
        expect(json(projectPath, "tsconfig.json").compilerOptions).toMatchObject({ strict: true, module: "NodeNext" });
      } else {
        expect(pkg.scripts).toEqual({ dev: "nodemon src/server.js", start: "node src/server.js" });
        expect(pkg.devDependencies).toEqual({ nodemon: "^3.0.0" });
        expect(fs.existsSync(path.join(projectPath, "tsconfig.json"))).toBe(false);
      }

      for (const folder of FOLDERS)
        expect(fs.existsSync(path.join(projectPath, "src", folder, `index.${ext}`))).toBe(true);
      expect(read(projectPath, `src/app.${ext}`)).toContain('project: "demo-app"');
      expect(read(projectPath, `src/server.${ext}`)).toContain("process.env.PORT");

      const envExample = read(projectPath, ".env.example");
      expect(envExample).toContain("PORT=3000");
      const expectedLine = ENV_LINES[database];
      if (expectedLine) expect(envExample).toContain(expectedLine);
      else expect(envExample).not.toMatch(/DB_|MONGO/);

      expect(read(projectPath, ".gitignore")).toContain(".env");
      expect(read(projectPath, "README.md")).toContain(`**${database}**`);
      expect(json(projectPath, "src/generated/schema.json").entities).toEqual([]);
    });
  });
});

describe("project generation details", () => {
  it("writes the approved AI spec to schema.json", async () => {
    const env = setup();
    const projectPath = path.join(env.cwd, "with-spec");
    await env.ctx.generator.generate({
      options: { projectName: "with-spec", language: "typescript", database: "postgresql" },
      projectPath,
      spec: VALID_SPEC
    });
    expect(json(projectPath, "src/generated/schema.json")).toEqual(VALID_SPEC);
  });

  it("derives a valid lowercase npm name but keeps the directory name", async () => {
    const env = setup();
    const projectPath = path.join(env.cwd, "My_API");
    await env.ctx.generator.generate({
      options: { projectName: "My_API", language: "javascript", database: "none" },
      projectPath
    });
    expect(json(projectPath, "package.json").name).toBe("my_api");
    expect(read(projectPath, "src/app.js")).toContain('project: "My_API"');
  });

  it("escapes the project name inside generated code", async () => {
    const env = setup();
    const projectPath = path.join(env.cwd, "quote-test");
    await env.ctx.generator.generate({
      options: { projectName: 'a"b', language: "javascript", database: "none" },
      projectPath
    });
    expect(read(projectPath, "src/app.js")).toContain('project: "a\\"b"');
  });

  it("never writes API keys or an .env file into the generated project", async () => {
    const env = setup({ env: { GEMINI_API_KEY: TEST_API_KEY } });
    await env.ctx.credentials.resolve("gemini");
    const projectPath = path.join(env.cwd, "no-secrets");
    await env.ctx.generator.generate({
      options: { projectName: "no-secrets", language: "typescript", database: "mongodb" },
      projectPath,
      spec: VALID_SPEC
    });
    const files = walk(projectPath);
    expect(files.some((file) => path.basename(file) === ".env")).toBe(false);
    for (const file of files) expect(fs.readFileSync(file, "utf8")).not.toContain(TEST_API_KEY);
  });

  it("refuses an existing directory and leaves it untouched", async () => {
    const env = setup();
    const projectPath = path.join(env.cwd, "taken");
    fs.mkdirSync(projectPath);
    fs.writeFileSync(path.join(projectPath, "keep.txt"), "mine");
    await expect(env.ctx.generator.assertAvailable(projectPath)).rejects.toMatchObject({ code: "PROJECT_EXISTS" });
    await expect(
      env.ctx.generator.generate({
        options: { projectName: "taken", language: "javascript", database: "none" },
        projectPath
      })
    ).rejects.toMatchObject({ code: "PROJECT_EXISTS" });
    expect(fs.readdirSync(projectPath)).toEqual(["keep.txt"]);
    expect(read(projectPath, "keep.txt")).toBe("mine");
  });

  it("also treats an existing file or dangling symlink as taken", async () => {
    const env = setup();
    const filePath = path.join(env.cwd, "afile");
    fs.writeFileSync(filePath, "x");
    await expect(env.ctx.generator.assertAvailable(filePath)).rejects.toMatchObject({ code: "PROJECT_EXISTS" });
    if (process.platform !== "win32") {
      const link = path.join(env.cwd, "dangling");
      fs.symlinkSync(path.join(env.cwd, "nowhere"), link);
      await expect(env.ctx.generator.assertAvailable(link)).rejects.toMatchObject({ code: "PROJECT_EXISTS" });
    }
  });

  it("fails on unknown templates before creating any directory", async () => {
    const env = setup();
    const projectPath = path.join(env.cwd, "bad-choice");
    await expect(
      env.ctx.generator.generate({
        options: { projectName: "bad-choice", language: "cobol", database: "none" },
        projectPath
      })
    ).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
    expect(fs.existsSync(projectPath)).toBe(false);
  });

  it("removes the directory it created when a write fails midway", async () => {
    // "clash" is written as a file, then "clash/inner" needs it to be a directory.
    const custom = envWithTemplates({
      "base/template.json": manifest({
        id: "base",
        category: "base",
        files: [
          { from: "a.tpl", to: "clash" },
          { from: "a.tpl", to: "clash/inner" }
        ]
      }),
      "base/a.tpl": "x"
    });
    const projectPath = path.join(custom.cwd, "half-written");
    await expect(
      custom.ctx.generator.generate({
        options: { projectName: "half-written", language: "javascript", database: "none" },
        projectPath
      })
    ).rejects.toBeInstanceOf(Error);
    expect(fs.existsSync(projectPath)).toBe(false);
  });

  it("rejects template output paths that would escape the project", async () => {
    const custom = envWithTemplates({
      "base/template.json": manifest({
        id: "base",
        category: "base",
        files: [{ from: "a.tpl", to: "../outside.txt" }]
      }),
      "base/a.tpl": "x"
    });
    const projectPath = path.join(custom.cwd, "evil");
    await expect(
      custom.ctx.generator.generate({
        options: { projectName: "evil", language: "javascript", database: "none" },
        projectPath
      })
    ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    expect(fs.existsSync(projectPath)).toBe(false);
    expect(fs.existsSync(path.join(custom.cwd, "outside.txt"))).toBe(false);
  });

  it("supports a brand-new language template added by dropping in a folder", async () => {
    const custom = envWithTemplates({
      "base/template.json": manifest({
        id: "base",
        category: "base",
        files: [{ from: "readme.tpl", to: "README.{{ext}}" }]
      }),
      "base/readme.tpl": "# {{projectName}} ({{language}})",
      "language/javascript/template.json": manifest({
        id: "language/javascript",
        category: "language",
        option: "javascript",
        label: "JS",
        variables: { ext: "js" }
      }),
      "language/coffee/template.json": manifest({
        id: "language/coffee",
        category: "language",
        option: "coffee",
        label: "CoffeeScript",
        variables: { ext: "coffee" },
        dependencies: { coffeescript: "^2.0.0" }
      }),
      "database/none/template.json": manifest({
        id: "database/none",
        category: "database",
        option: "none",
        label: "None"
      })
    });
    expect((await custom.ctx.catalog.choices("language")).map((choice) => choice.value).sort()).toEqual([
      "coffee",
      "javascript"
    ]);
    const projectPath = path.join(custom.cwd, "brew");
    await custom.ctx.generator.generate({
      options: { projectName: "brew", language: "coffee", database: "none" },
      projectPath
    });
    expect(read(projectPath, "README.coffee")).toBe("# brew (coffee)");
    expect(json(projectPath, "package.json").dependencies).toHaveProperty("coffeescript");
  });
});

describe("template catalog", () => {
  it("lists choices in display order with defaults from the manifests", async () => {
    const env = setup();
    expect(await env.ctx.catalog.choices("language")).toEqual([
      { value: "typescript", label: "TypeScript", isDefault: true },
      { value: "javascript", label: "JavaScript", isDefault: false }
    ]);
    expect((await env.ctx.catalog.choices("database")).map((choice) => choice.value)).toEqual([
      "postgresql",
      "mysql",
      "mongodb",
      "none"
    ]);
    expect(await env.ctx.catalog.choices("framework")).toEqual([]);
  });
});
