import { describe, expect, it } from "vitest";
import { defaultConfig, migrateConfig, type ConfigMigration } from "../../src/application/config.js";

describe("migrateConfig", () => {
  it("accepts the current version and fills defaults", () => {
    expect(migrateConfig({ configVersion: 1 })).toEqual({
      configVersion: 1,
      credentialBackend: "keyring",
      providers: {}
    });
  });

  it("round-trips a full config", () => {
    const config = {
      ...defaultConfig(),
      aiEnabled: true,
      defaultProvider: "gemini",
      providers: { gemini: { model: "m" } }
    };
    expect(migrateConfig(config)).toEqual(config);
  });

  it("rejects non-objects, missing versions and invalid shapes", () => {
    expect(() => migrateConfig("x")).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
    expect(() => migrateConfig([])).toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
    expect(() => migrateConfig({})).toThrowError(/configVersion/);
    expect(() => migrateConfig({ configVersion: 1, credentialBackend: "cloud" })).toThrowError(/credentialBackend/);
  });

  it("refuses configs written by a newer version", () => {
    expect(() => migrateConfig({ configVersion: 99 })).toThrowError(/newer ExpressForge/);
  });

  it("applies migrations in order up to the target version", () => {
    const migrations: ConfigMigration[] = [
      { from: 1, migrate: (raw) => ({ ...raw, defaultProvider: "renamed" }) },
      { from: 2, migrate: (raw) => ({ ...raw, aiEnabled: true }) }
    ];
    const result = migrateConfig({ configVersion: 1 }, migrations, 3);
    expect(result).toMatchObject({ configVersion: 3, defaultProvider: "renamed", aiEnabled: true });
  });

  it("fails clearly when a migration step is missing", () => {
    expect(() => migrateConfig({ configVersion: 1 }, [], 2)).toThrowError(
      /No migration is available from config version 1/
    );
  });
});
