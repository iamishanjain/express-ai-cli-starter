import { z } from "zod";

export const DatabaseSchema = z.enum(["postgresql", "mysql", "mongodb", "none"]);
export const FieldType = z.enum([
  "string", "text", "integer", "number", "boolean", "date", "datetime", "uuid", "json", "enum"
]);

export const FieldSpecSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/, "Field names must start with a lowercase letter."),
  type: FieldType,
  nullable: z.boolean(),
  unique: z.boolean(),
  primaryKey: z.boolean(),
  description: z.string()
});

export const EntitySpecSchema = z.object({
  name: z.string().regex(/^[A-Z][a-zA-Z0-9]*$/, "Entity names must be PascalCase."),
  tableName: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string(),
  fields: z.array(FieldSpecSchema).min(1).max(40)
});

export const ProjectSpecSchema = z.object({
  schemaVersion: z.literal(1),
  projectSummary: z.string(),
  entities: z.array(EntitySpecSchema).max(20),
  suggestedModules: z.array(z.string()).max(20),
  assumptions: z.array(z.string()).max(20)
});

export type ProjectSpec = z.infer<typeof ProjectSpecSchema>;
export type DatabaseChoice = z.infer<typeof DatabaseSchema>;
export type LanguageChoice = "javascript" | "typescript";
