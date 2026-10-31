import fs from "node:fs/promises";
import path from "node:path";
import { ExpressForgeError } from "../../shared/errors.js";
import { isNodeError } from "../fs/secure-files.js";
import { resolveInside } from "../fs/safe-path.js";
import { BASE_CATEGORY, TemplateManifestSchema, type LoadedTemplate } from "./manifest.js";

const MANIFEST_FILE = "template.json";

/**
 * Discovers templates on disk: `<root>/base` and `<root>/<category>/<option>`.
 * Adding a template is adding a folder with a template.json; no code changes.
 */
export class FileSystemTemplateSource {
  private cache: Promise<LoadedTemplate[]> | undefined;

  constructor(private readonly root: string) {}

  loadAll(): Promise<LoadedTemplate[]> {
    this.cache ??= this.discover();
    return this.cache;
  }

  async readFile(template: LoadedTemplate, relativePath: string): Promise<string> {
    const absolute = resolveInside(template.directory, relativePath);
    try {
      return await fs.readFile(absolute, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new ExpressForgeError("TEMPLATE_NOT_FOUND", `Template "${template.manifest.id}" is missing file "${relativePath}".`);
      }
      throw error;
    }
  }

  private async discover(): Promise<LoadedTemplate[]> {
    const directories: string[] = [path.join(this.root, BASE_CATEGORY)];
    for (const category of await this.subdirectories(this.root)) {
      if (category === BASE_CATEGORY) continue;
      for (const option of await this.subdirectories(path.join(this.root, category))) {
        directories.push(path.join(this.root, category, option));
      }
    }

    const templates: LoadedTemplate[] = [];
    for (const directory of directories) templates.push(await this.load(directory));
    this.assertUniqueIds(templates);
    return templates;
  }

  private async load(directory: string): Promise<LoadedTemplate> {
    const manifestPath = path.join(directory, MANIFEST_FILE);
    const relative = path.relative(this.root, directory).split(path.sep).join("/");

    let text: string;
    try {
      text = await fs.readFile(manifestPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new ExpressForgeError("TEMPLATE_NOT_FOUND", `Template folder "${relative}" has no ${MANIFEST_FILE}.`);
      }
      throw error;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ExpressForgeError("TEMPLATE_INVALID", `Template "${relative}" has an invalid ${MANIFEST_FILE} (not JSON).`);
    }

    const parsed = TemplateManifestSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ExpressForgeError(
        "TEMPLATE_INVALID",
        `Template "${relative}" has an invalid ${MANIFEST_FILE}: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`
      );
    }
    const manifest = parsed.data;
    if (manifest.id !== relative) {
      throw new ExpressForgeError("TEMPLATE_INVALID", `Template id "${manifest.id}" does not match its folder "${relative}".`);
    }

    const template: LoadedTemplate = { manifest, directory };
    for (const file of manifest.files) {
      const absolute = resolveInside(directory, file.from);
      try {
        await fs.access(absolute);
      } catch {
        throw new ExpressForgeError("TEMPLATE_NOT_FOUND", `Template "${manifest.id}" references missing file "${file.from}".`);
      }
    }
    return template;
  }

  private async subdirectories(directory: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new ExpressForgeError("TEMPLATE_NOT_FOUND", "The templates directory could not be found.", {
          hint: "The installation may be corrupted; try reinstalling ExpressForge."
        });
      }
      throw error;
    }
  }

  private assertUniqueIds(templates: readonly LoadedTemplate[]): void {
    const seen = new Set<string>();
    for (const { manifest } of templates) {
      if (seen.has(manifest.id)) {
        throw new ExpressForgeError("TEMPLATE_INVALID", `Duplicate template id "${manifest.id}".`);
      }
      seen.add(manifest.id);
    }
  }
}
