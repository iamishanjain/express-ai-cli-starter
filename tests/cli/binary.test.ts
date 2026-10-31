import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const bin = path.join(root, "dist/bin/main.js");
let sandbox: string;

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "ignore", shell: process.platform === "win32" });
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ef-binary-"));
}, 120_000);
afterAll(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function cli(args: string[], extraEnv: Record<string, string> = {}) {
  const home = path.join(sandbox, "home");
  fs.mkdirSync(home, { recursive: true });
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: sandbox,
    encoding: "utf8",
    input: "",
    env: {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      EXPRESSFORGE_CONFIG_DIR: path.join(sandbox, "config"),
      ...extraEnv
    }
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("built binary", () => {
  it("has a node shebang and is executable", () => {
    expect(fs.readFileSync(bin, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(bin).mode & 0o111).not.toBe(0);
  });

  it("prints the package version", () => {
    const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
    for (const flag of ["--version", "-V"]) {
      expect(cli([flag])).toMatchObject({ code: 0, stdout: `${version}\n` });
    }
  });

  it("prints help listing every command", () => {
    const { code, stdout } = cli(["--help"]);
    expect(code).toBe(0);
    for (const command of ["create", "config", "providers"]) expect(stdout).toContain(command);
  });

  it("generates a project non-interactively without any API key", () => {
    const { code, stdout } = cli([
      "create",
      "--name",
      "bin-app",
      "--language",
      "javascript",
      "--database",
      "mysql",
      "--no-ai"
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("Project created successfully!");
    const pkg = JSON.parse(fs.readFileSync(path.join(sandbox, "bin-app/package.json"), "utf8"));
    expect(pkg.dependencies).toHaveProperty("mysql2");
  });

  it("exits with 5 when the directory exists", () => {
    const { code, stderr } = cli([
      "create",
      "--name",
      "bin-app",
      "--language",
      "javascript",
      "--database",
      "mysql",
      "--no-ai"
    ]);
    expect(code).toBe(5);
    expect(stderr).toContain("PROJECT_EXISTS");
  });

  it("never hangs waiting for input when there is no terminal", () => {
    const { code, stderr } = cli(["create"]);
    expect(code).toBe(2);
    expect(stderr).toContain("--name");
  });

  it("exits with 2 on usage errors", () => {
    expect(cli(["create", "--bogus"]).code).toBe(2);
  });

  it("lists providers and never reveals a key from the environment", () => {
    const secret = "AIzaSyBINARYTEST0123456789abcdefghijkl";
    const { code, stdout, stderr } = cli(["providers", "list", "--json"], { GEMINI_API_KEY: secret });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)[0]).toMatchObject({ id: "gemini", credential: "env" });
    expect(stdout + stderr).not.toContain(secret);
  });

  it("refuses to print a stored key and keeps debug output redacted", () => {
    const secret = "AIzaSyBINARYTEST0123456789abcdefghijkl";
    const { code, stdout, stderr } = cli(["config", "get", "api-key", "--debug"], { GEMINI_API_KEY: secret });
    expect(code).toBe(2);
    expect(stdout + stderr).not.toContain(secret);
  });

  it("validate fails cleanly (exit 3) without a key", () => {
    expect(cli(["config", "validate"]).code).toBe(3);
  });
});
