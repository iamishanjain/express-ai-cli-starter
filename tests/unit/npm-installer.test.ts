import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NpmInstaller } from "../../src/infrastructure/system/npm-installer.js";
import { registerSecret, clearRegisteredSecrets } from "../../src/shared/redact.js";

// These tests put a stub `npm` first on PATH, so no real install ever runs.
describe.skipIf(process.platform === "win32")("NpmInstaller", () => {
  let dir: string;
  let log: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-npm-"));
    log = path.join(dir, "invocation.json");
    vi.stubEnv("PATH", `${dir}${path.delimiter}${process.env.PATH}`);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    clearRegisteredSecrets();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const stubNpm = (script: string) => {
    const file = path.join(dir, "npm");
    fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  };

  it("runs `npm install` in the project directory with a fixed argument list", async () => {
    stubNpm(`printf '{"args":"%s","cwd":"%s"}' "$*" "$PWD" > '${log}'`);
    const project = fs.mkdtempSync(path.join(dir, "project-"));
    await new NpmInstaller().install(project);
    const call = JSON.parse(fs.readFileSync(log, "utf8"));
    expect(call.args).toBe("install");
    expect(fs.realpathSync(call.cwd)).toBe(fs.realpathSync(project));
  });

  it("does not interpret shell metacharacters in the directory name", async () => {
    stubNpm("exit 0");
    const project = path.join(dir, "weird $(touch pwned) ; name");
    fs.mkdirSync(project);
    await new NpmInstaller().install(project);
    expect(fs.existsSync(path.join(dir, "pwned"))).toBe(false);
    expect(fs.existsSync(path.join(project, "pwned"))).toBe(false);
  });

  it("reports a non-zero exit as INSTALL_FAILED with a redacted output tail", async () => {
    registerSecret("super-secret-token-value");
    stubNpm(`echo "ERR! auth super-secret-token-value" >&2; exit 3`);
    await expect(new NpmInstaller().install(dir)).rejects.toSatisfy(
      (error: { code: string; details?: Record<string, unknown>; message: string }) => {
        expect(error.code).toBe("INSTALL_FAILED");
        expect(error.message).toContain("exit code 3");
        expect(String(error.details?.output)).toContain("ERR! auth");
        expect(String(error.details?.output)).not.toContain("super-secret-token-value");
        return true;
      }
    );
  });

  it("reports a missing npm executable", async () => {
    vi.stubEnv("PATH", path.join(dir, "empty"));
    await expect(new NpmInstaller().install(dir)).rejects.toMatchObject({
      code: "INSTALL_FAILED",
      message: "Could not run npm."
    });
  });

  it("stops the install when the signal aborts", async () => {
    stubNpm("sleep 30");
    const controller = new AbortController();
    const pending = new NpmInstaller().install(dir, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({ code: "INSTALL_FAILED" });
  });
});
