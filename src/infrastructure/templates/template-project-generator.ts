import fs from "node:fs/promises";
import path from "node:path";
import { toPackageName } from "../../application/project.js";
import type {
  GeneratedProject,
  GenerateProjectRequest,
  ProjectGenerator,
  TemplateCatalog,
  TemplateChoice
} from "../../application/ports.js";
import { ExpressForgeError, isExpressForgeError } from "../../shared/errors.js";
import { isNodeError, toFilesystemError } from "../fs/secure-files.js";
import { resolveInside } from "../fs/safe-path.js";
import { buildPlan, selectTemplates, type PlannedFile } from "./template-engine.js";
import type { FileSystemTemplateSource } from "./template-source.js";

/** Renders the selected templates into a new project directory. */
export class TemplateProjectGenerator implements ProjectGenerator, TemplateCatalog {
  constructor(private readonly source: FileSystemTemplateSource) {}

  async choices(category: string): Promise<TemplateChoice[]> {
    const all = await this.source.loadAll();
    return all
      .filter((template) => template.manifest.category === category && template.manifest.option)
      .sort((a, b) => a.manifest.order - b.manifest.order || a.manifest.id.localeCompare(b.manifest.id))
      .map(({ manifest }) => ({
        value: manifest.option as string,
        label: manifest.label ?? (manifest.option as string),
        isDefault: manifest.default
      }));
  }

  async assertAvailable(projectPath: string): Promise<void> {
    try {
      await fs.lstat(projectPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw toFilesystemError(error, "check the project directory", projectPath);
    }
    throw projectExists(projectPath);
  }

  async generate(request: GenerateProjectRequest): Promise<GeneratedProject> {
    const { options, projectPath, spec } = request;
    const templates = selectTemplates(await this.source.loadAll(), {
      language: options.language,
      database: options.database
    });

    const plan = await buildPlan({
      templates,
      readTemplateFile: (template, relativePath) => this.source.readFile(template, relativePath),
      variables: {
        projectName: options.projectName,
        projectNameJson: JSON.stringify(options.projectName),
        packageName: toPackageName(options.projectName),
        language: options.language,
        database: options.database
      },
      packageName: toPackageName(options.projectName),
      spec
    });

    // Validate every destination before touching the disk.
    const targets = plan.map((file) => ({ file, absolute: resolveInside(projectPath, file.path) }));

    try {
      await fs.mkdir(projectPath, { recursive: false });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") throw projectExists(projectPath);
      throw toFilesystemError(error, "create the project directory", projectPath);
    }

    try {
      for (const { file, absolute } of targets) await writeNewFile(absolute, file);
    } catch (error) {
      await fs.rm(projectPath, { recursive: true, force: true });
      throw isExpressForgeError(error) ? error : toFilesystemError(error, "write project files", projectPath);
    }
    return { projectPath, files: plan.map((file) => file.path) };
  }
}

async function writeNewFile(absolute: string, file: PlannedFile): Promise<void> {
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  // "wx" refuses to overwrite: two planned files can never silently clobber each other.
  await fs.writeFile(absolute, file.content, { flag: "wx" });
}

function projectExists(projectPath: string): ExpressForgeError {
  return new ExpressForgeError("PROJECT_EXISTS", `Directory already exists: ${projectPath}`, {
    hint: "Choose a different project name or remove the existing directory."
  });
}
