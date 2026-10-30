import { GoogleGenAI } from "@google/genai";
import { ProjectSpecSchema, type ProjectSpec } from "../types/spec.js";
import type { AIProvider, ProjectAnalysisInput } from "./provider.js";

const responseJsonSchema = {
  type: "OBJECT",
  properties: {
    schemaVersion: { type: "INTEGER" },
    projectSummary: { type: "STRING" },
    entities: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          tableName: { type: "STRING" },
          description: { type: "STRING" },
          fields: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                type: { type: "STRING", enum: ["string", "text", "integer", "number", "boolean", "date", "datetime", "uuid", "json", "enum"] },
                nullable: { type: "BOOLEAN" },
                unique: { type: "BOOLEAN" },
                primaryKey: { type: "BOOLEAN" },
                description: { type: "STRING" }
              },
              required: ["name", "type", "nullable", "unique", "primaryKey", "description"],
              propertyOrdering: ["name", "type", "nullable", "unique", "primaryKey", "description"]
            }
          }
        },
        required: ["name", "tableName", "description", "fields"],
        propertyOrdering: ["name", "tableName", "description", "fields"]
      }
    },
    suggestedModules: { type: "ARRAY", items: { type: "STRING" } },
    assumptions: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["schemaVersion", "projectSummary", "entities", "suggestedModules", "assumptions"],
  propertyOrdering: ["schemaVersion", "projectSummary", "entities", "suggestedModules", "assumptions"]
};

export class GeminiProvider implements AIProvider {
  async proposeProjectSpec(input: ProjectAnalysisInput): Promise<ProjectSpec> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing. Set it in your shell before enabling AI.");
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const prompt = `
You are a senior backend architect. Propose a conservative, normalized logical data model for a new Express API.
Return only the JSON structure requested by the response schema.
Do not generate code, SQL, secrets, or executable instructions.
Use schemaVersion 1.
Use PascalCase entity names and snake_case table/field names.
Every entity must have an id field of type uuid marked primaryKey=true, nullable=false, unique=true.
Use only the allowed field types. Avoid unnecessary entities and avoid adding fields not reasonably implied by the requirements.
For fields whose values should be protected, do not suggest storing plaintext credentials.
For relationships that cannot be represented in this starter schema, mention them in assumptions.
Database selected: ${input.database}
Project description:
${input.description}
`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema
      }
    });

    if (!response.text) {
      throw new Error("Gemini returned an empty response.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      throw new Error("Gemini returned invalid JSON.");
    }

    const result = ProjectSpecSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Gemini response failed validation: ${result.error.message}`);
    }

    validateUniqueNames(result.data);
    return result.data;
  }
}

function validateUniqueNames(spec: ProjectSpec): void {
  const entityNames = new Set<string>();
  const tableNames = new Set<string>();

  for (const entity of spec.entities) {
    if (entityNames.has(entity.name)) {
      throw new Error(`Duplicate entity name: ${entity.name}`);
    }
    if (tableNames.has(entity.tableName)) {
      throw new Error(`Duplicate table name: ${entity.tableName}`);
    }
    entityNames.add(entity.name);
    tableNames.add(entity.tableName);

    const fieldNames = new Set<string>();
    for (const field of entity.fields) {
      if (fieldNames.has(field.name)) {
        throw new Error(`Duplicate field "${field.name}" in entity "${entity.name}"`);
      }
      fieldNames.add(field.name);
    }
    if (!entity.fields.some((field) => field.name === "id" && field.primaryKey)) {
      throw new Error(`Entity "${entity.name}" is missing its required id primary key.`);
    }
  }
}
