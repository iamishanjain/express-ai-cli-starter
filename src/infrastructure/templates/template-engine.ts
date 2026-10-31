import { EMPTY_PROJECT_SPEC, type ProjectSpec } from "../../domain/project-spec.js";
import { ExpressForgeError } from "../../shared/errors.js";
import { BASE_CATEGORY, type LoadedTemplate } from "./manifest.js";

export interface PlannedFile {
  /** Path relative to the project root. */
  readonly path: string;
  readonly content: string;
}

export type TemplateVariables = Readonly<Record<string, string>>;

export interface MergedTemplates {
  readonly packageFields: Record<string, string | boolean>;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly scripts: Record<string, string>;
  readonly env: string[];
  readonly variables: Record<string, string>;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g;

/** Picks the base template plus one template per requested category/option. */
export function selectTemplates(
  all: readonly LoadedTemplate[],
  selections: Readonly<Record<string, string>>
): LoadedTemplate[] {
  const base = all.find((template) => template.manifest.category === BASE_CATEGORY);
  if (!base) throw new ExpressForgeError("TEMPLATE_NOT_FOUND", "The base template is missing.");

  const selected = [base];
  for (const [category, option] of Object.entries(selections)) {
    const match = all.find(
      (template) => template.manifest.category === category && template.manifest.option === option
    );
    if (!match) {
      const available = all
        .filter((template) => template.manifest.category === category)
        .map((template) => template.manifest.option)
        .join(", ");
      throw new ExpressForgeError("TEMPLATE_NOT_FOUND", `No ${category} template named "${option}".`, {
        hint: available ? `Available ${category} options: ${available}.` : `No ${category} templates are installed.`
      });
    }
    selected.push(match);
  }
  return selected;
}

/** Combines manifests deterministically. Conflicting values for one key are an error. */
export function mergeTemplates(templates: readonly LoadedTemplate[]): MergedTemplates {
  const merged: MergedTemplates = {
    packageFields: {},
    dependencies: {},
    devDependencies: {},
    scripts: {},
    env: [],
    variables: {}
  };

  for (const { manifest } of templates) {
    assign(merged.packageFields, manifest.package, "package field", manifest.id);
    assign(merged.dependencies, manifest.dependencies, "dependency", manifest.id);
    assign(merged.devDependencies, manifest.devDependencies, "devDependency", manifest.id);
    assign(merged.scripts, manifest.scripts, "script", manifest.id);
    assign(merged.variables, manifest.variables, "variable", manifest.id);
    for (const line of manifest.env) if (!merged.env.includes(line)) merged.env.push(line);
  }
  return merged;
}

function assign<T extends string | boolean>(
  target: Record<string, T>,
  source: Readonly<Record<string, T>>,
  kind: string,
  templateId: string
): void {
  for (const [key, value] of Object.entries(source)) {
    if (key in target && target[key] !== value) {
      throw new ExpressForgeError(
        "TEMPLATE_INVALID",
        `Template "${templateId}" sets ${kind} "${key}" to a value that conflicts with another template.`
      );
    }
    target[key] = value;
  }
}

/** Replaces `{{name}}` with a variable. Unknown names fail loudly instead of rendering blanks. */
export function renderText(text: string, variables: TemplateVariables, templateId: string): string {
  return text.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      throw new ExpressForgeError("TEMPLATE_INVALID", `Template "${templateId}" uses unknown variable "{{${name}}}".`);
    }
    return value;
  });
}

export interface PlanInput {
  readonly templates: readonly LoadedTemplate[];
  readonly readTemplateFile: (template: LoadedTemplate, relativePath: string) => Promise<string>;
  readonly variables: TemplateVariables;
  readonly packageName: string;
  readonly spec?: ProjectSpec;
}

/** Computes every file of the project in memory, so nothing is written if planning fails. */
export async function buildPlan(input: PlanInput): Promise<PlannedFile[]> {
  const merged = mergeTemplates(input.templates);
  const variables: TemplateVariables = { ...merged.variables, ...input.variables };
  const files = new Map<string, PlannedFile>();

  const add = (file: PlannedFile, owner: string): void => {
    if (files.has(file.path)) {
      throw new ExpressForgeError("TEMPLATE_INVALID", `More than one template writes "${file.path}" (${owner}).`);
    }
    files.set(file.path, file);
  };

  for (const template of input.templates) {
    for (const entry of template.manifest.files) {
      const content = renderText(await input.readTemplateFile(template, entry.from), variables, template.manifest.id);
      add({ path: renderText(entry.to, variables, template.manifest.id), content }, template.manifest.id);
    }
  }

  add({ path: "package.json", content: renderPackageJson(merged, input.packageName) }, "generator");
  add({ path: ".env.example", content: `${merged.env.join("\n")}\n` }, "generator");
  add(
    { path: "src/generated/schema.json", content: `${JSON.stringify(input.spec ?? EMPTY_PROJECT_SPEC, null, 2)}\n` },
    "generator"
  );
  return [...files.values()];
}

function renderPackageJson(merged: MergedTemplates, packageName: string): string {
  const packageJson: Record<string, unknown> = {
    name: packageName,
    ...merged.packageFields,
    scripts: merged.scripts,
    dependencies: sortKeys(merged.dependencies)
  };
  if (Object.keys(merged.devDependencies).length > 0) packageJson.devDependencies = sortKeys(merged.devDependencies);
  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

function sortKeys(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
