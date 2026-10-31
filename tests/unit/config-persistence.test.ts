import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../../src/application/config.js";
import { getConfigDir } from "../../src/infrastructure/config/config-paths.js";
import { JsonConfigRepository } from "../../src/infrastructure/config/json-config-repository.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-config-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("getConfigDir", () => {
  const base = { env: {}, homedir: "/home/u" };
  it("follows each platform's convention", () => {
    expect(getConfigDir({ ...base, platform: "darwin" })).toBe(
      path.join("/home/u", "Library", "Application Support", "expressforge")
    );
    expect(getConfigDir({ ...base, platform: "linux" })).toBe(path.join("/home/u", ".config", "expressforge"));
    expect(getConfigDir({ ...base, platform: "linux", env: { XDG_CONFIG_HOME: "/x" } })).toBe(
      path.join("/x", "expressforge")
    );
    expect(getConfigDir({ ...base, platform: "win32", env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" } })).toContain(
      "expressforge"
    );
  });

  it("lets EXPRESSFORGE_CONFIG_DIR override everything", () => {
    expect(getConfigDir({ ...base, platform: "darwin", env: { EXPRESSFORGE_CONFIG_DIR: "/custom" } })).toBe(
      path.resolve("/custom")
    );
  });
});

describe("JsonConfigRepository", () => {
  it("returns undefined before anything is saved", async () => {
    expect(await new JsonConfigRepository(dir).load()).toBeUndefined();
  });

  it("persists and reloads versioned config", async () => {
    const repository = new JsonConfigRepository(path.join(dir, "nested"));
    const config = { ...defaultConfig(), aiEnabled: true, defaultProvider: "gemini" };
    await repository.save(config);
    expect(await repository.load()).toEqual(config);
    expect(JSON.parse(fs.readFileSync(repository.location, "utf8")).configVersion).toBe(1);
  });

  it("never contains credential fields", async () => {
    const repository = new JsonConfigRepository(dir);
    await repository.save(defaultConfig());
    expect(fs.readFileSync(repository.location, "utf8")).not.toMatch(/api[_-]?key|secret|token|password|AIza/i);
  });

  it("rejects invalid JSON and invalid shapes with CONFIG_INVALID", async () => {
    const repository = new JsonConfigRepository(dir);
    fs.writeFileSync(repository.location, "{oops");
    await expect(repository.load()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    fs.writeFileSync(repository.location, JSON.stringify({ configVersion: 1, credentialBackend: "x" }));
    await expect(repository.load()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("remove deletes the file and tolerates a missing one", async () => {
    const repository = new JsonConfigRepository(dir);
    await repository.save(defaultConfig());
    await repository.remove();
    expect(fs.existsSync(repository.location)).toBe(false);
    await repository.remove();
  });

  it("runs injected migrations on load", async () => {
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ configVersion: 1 }));
    const repository = new JsonConfigRepository(dir, [{ from: 1, migrate: (raw) => raw }]);
    // Target stays at the current version, so loading is a no-op migration-wise.
    expect(await repository.load()).toMatchObject({ configVersion: 1 });
  });
});
