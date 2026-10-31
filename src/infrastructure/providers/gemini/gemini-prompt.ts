import type { ProjectAnalysisInput } from "../../../domain/ai-provider.js";
import { FIELD_TYPES } from "../../../domain/project-spec.js";

const FIELD_PROPERTIES = ["name", "type", "nullable", "unique", "primaryKey", "description"];
const ENTITY_PROPERTIES = ["name", "tableName", "description", "fields"];
const SPEC_PROPERTIES = ["schemaVersion", "projectSummary", "entities", "suggestedModules", "assumptions"];

/** Gemini response schema; mirrors ProjectSpecSchema (which stays the source of truth). */
export const RESPONSE_JSON_SCHEMA = {
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
                type: { type: "STRING", enum: [...FIELD_TYPES] },
                nullable: { type: "BOOLEAN" },
                unique: { type: "BOOLEAN" },
                primaryKey: { type: "BOOLEAN" },
                description: { type: "STRING" }
              },
              required: FIELD_PROPERTIES,
              propertyOrdering: FIELD_PROPERTIES
            }
          }
        },
        required: ENTITY_PROPERTIES,
        propertyOrdering: ENTITY_PROPERTIES
      }
    },
    suggestedModules: { type: "ARRAY", items: { type: "STRING" } },
    assumptions: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: SPEC_PROPERTIES,
  propertyOrdering: SPEC_PROPERTIES
};

export function buildPrompt(input: ProjectAnalysisInput): string {
  return `
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
}
