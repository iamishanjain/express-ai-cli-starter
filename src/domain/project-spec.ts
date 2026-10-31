import { z } from "zod";
import { ExpressForgeError } from "../shared/errors.js";

export const FIELD_TYPES = [
  "string",
  "text",
  "integer",
  "number",
  "boolean",
  "date",
  "datetime",
  "uuid",
  "json",
  "enum"
] as const;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/** AI text is untrusted: bound its size and strip terminal control sequences. */
const safeText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.replace(CONTROL_CHARACTERS, " ").trim());

export const FieldType = z.enum(FIELD_TYPES);

export const FieldSpecSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9_]*$/, "Field names must start with a lowercase letter.")
    .max(64),
  type: FieldType,
  nullable: z.boolean(),
  unique: z.boolean(),
  primaryKey: z.boolean(),
  description: safeText(500)
});

export const EntitySpecSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Z][a-zA-Z0-9]*$/, "Entity names must be PascalCase.")
    .max(64),
  tableName: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(64),
  description: safeText(500),
  fields: z.array(FieldSpecSchema).min(1).max(40)
});

export const PROJECT_SPEC_VERSION = 1;

export const ProjectSpecSchema = z.object({
  schemaVersion: z.literal(PROJECT_SPEC_VERSION),
  projectSummary: safeText(2000),
  entities: z.array(EntitySpecSchema).max(20),
  suggestedModules: z.array(safeText(200)).max(20),
  assumptions: z.array(safeText(500)).max(20)
});

export type ProjectSpec = z.output<typeof ProjectSpecSchema>;
export type EntitySpec = ProjectSpec["entities"][number];

/** Placeholder written to generated projects when no AI proposal was requested. */
export const EMPTY_PROJECT_SPEC: ProjectSpec = {
  schemaVersion: PROJECT_SPEC_VERSION,
  projectSummary: "AI schema generation was skipped.",
  entities: [],
  suggestedModules: [],
  assumptions: ["Run the CLI again with AI enabled to propose a schema."]
};

/** Validates untrusted data (for example an AI response) as a ProjectSpec. */
export function parseProjectSpec(data: unknown): ProjectSpec {
  const result = ProjectSpecSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ExpressForgeError(
      "INVALID_AI_RESPONSE",
      `The AI response did not match the project schema (${issues}).`,
      {
        hint: "Try again, or rephrase your project description.",
        details: { issueCount: result.error.issues.length }
      }
    );
  }
  validateSpecRules(result.data);
  return result.data;
}

/** Business rules that the structural schema cannot express. */
export function validateSpecRules(spec: ProjectSpec): void {
  const entityNames = new Set<string>();
  const tableNames = new Set<string>();

  for (const entity of spec.entities) {
    if (entityNames.has(entity.name)) fail(`Duplicate entity name: ${entity.name}`);
    if (tableNames.has(entity.tableName)) fail(`Duplicate table name: ${entity.tableName}`);
    entityNames.add(entity.name);
    tableNames.add(entity.tableName);

    const fieldNames = new Set<string>();
    for (const field of entity.fields) {
      if (fieldNames.has(field.name)) fail(`Duplicate field "${field.name}" in entity "${entity.name}"`);
      fieldNames.add(field.name);
    }
    if (!entity.fields.some((field) => field.name === "id" && field.primaryKey)) {
      fail(`Entity "${entity.name}" is missing its required id primary key.`);
    }
  }
}

function fail(message: string): never {
  throw new ExpressForgeError("SCHEMA_VALIDATION_FAILED", message, {
    hint: "Try again, or rephrase your project description."
  });
}
