import { describe, expect, it } from "vitest";
import { parseProjectSpec } from "../../src/domain/project-spec.js";
import { VALID_SPEC } from "../helpers/fakes.js";

const clone = () => structuredClone(VALID_SPEC);

describe("parseProjectSpec", () => {
  it("accepts a valid specification and is idempotent", () => {
    const once = parseProjectSpec(VALID_SPEC);
    expect(once).toEqual(VALID_SPEC);
    expect(parseProjectSpec(once)).toEqual(once);
  });

  it("rejects an unsupported schemaVersion", () => {
    expect(() => parseProjectSpec({ ...clone(), schemaVersion: 2 })).toThrowError(/did not match/);
  });

  it("rejects non-object input", () => {
    expect(() => parseProjectSpec("nope")).toThrowError(expect.objectContaining({ code: "INVALID_AI_RESPONSE" }));
    expect(() => parseProjectSpec(null)).toThrowError(expect.objectContaining({ code: "INVALID_AI_RESPONSE" }));
  });

  it("enforces naming rules", () => {
    const badEntity = clone();
    badEntity.entities[0]!.name = "book";
    expect(() => parseProjectSpec(badEntity)).toThrowError(/PascalCase/);

    const badField = clone();
    badField.entities[0]!.fields[1]!.name = "Title";
    expect(() => parseProjectSpec(badField)).toThrowError(/lowercase/);
  });

  it("rejects unknown field types", () => {
    const spec = clone();
    (spec.entities[0]!.fields[1] as { type: string }).type = "blob";
    expect(() => parseProjectSpec(spec)).toThrowError(expect.objectContaining({ code: "INVALID_AI_RESPONSE" }));
  });

  it("rejects duplicate entity, table and field names", () => {
    const dupEntity = clone();
    dupEntity.entities.push({ ...dupEntity.entities[0]!, tableName: "other" });
    expect(() => parseProjectSpec(dupEntity)).toThrowError(/Duplicate entity name: Book/);

    const dupTable = clone();
    dupTable.entities.push({ ...dupTable.entities[0]!, name: "Other" });
    expect(() => parseProjectSpec(dupTable)).toThrowError(/Duplicate table name: books/);

    const dupField = clone();
    dupField.entities[0]!.fields.push({ ...dupField.entities[0]!.fields[1]! });
    expect(() => parseProjectSpec(dupField)).toThrowError(/Duplicate field "title"/);
  });

  it("requires an id primary key on every entity", () => {
    const spec = clone();
    spec.entities[0]!.fields[0]!.primaryKey = false;
    expect(() => parseProjectSpec(spec)).toThrowError(expect.objectContaining({ code: "SCHEMA_VALIDATION_FAILED" }));
  });

  it("strips terminal control characters from AI text", () => {
    const spec = clone();
    spec.projectSummary = "Hello\u001b[31m red\u0007";
    spec.assumptions = ["line\nbreak"];
    const parsed = parseProjectSpec(spec);
    // eslint-disable-next-line no-control-regex
    expect(parsed.projectSummary).not.toMatch(/[\u0000-\u001f]/);
    expect(parsed.assumptions[0]).toBe("line break");
  });

  it("bounds the size of AI text", () => {
    const spec = clone();
    spec.projectSummary = "x".repeat(2001);
    expect(() => parseProjectSpec(spec)).toThrowError(expect.objectContaining({ code: "INVALID_AI_RESPONSE" }));
  });
});
