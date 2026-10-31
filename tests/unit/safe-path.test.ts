import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInside } from "../../src/infrastructure/fs/safe-path.js";

const root = path.resolve("/tmp/project");

describe("resolveInside", () => {
  it("resolves normal nested paths", () => {
    expect(resolveInside(root, "src/app.ts")).toBe(path.join(root, "src", "app.ts"));
    expect(resolveInside(root, "./a/./b.txt")).toBe(path.join(root, "a", "b.txt"));
  });

  it.each([
    "../escape.txt",
    "a/../../escape.txt",
    "/etc/passwd",
    "C:\\Windows\\x",
    "\\\\server\\share\\x",
    "..",
    ".",
    "",
    "a\0b"
  ])("rejects %j", (candidate) => {
    expect(() => resolveInside(root, candidate)).toThrowError(expect.objectContaining({ code: "UNSAFE_PATH" }));
  });

  it("allows names that merely start with two dots", () => {
    expect(resolveInside(root, "..hidden/file")).toBe(path.join(root, "..hidden", "file"));
  });
});
