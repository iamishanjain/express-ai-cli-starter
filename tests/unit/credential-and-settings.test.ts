import { describe, expect, it } from "vitest";
import { createTestEnvironment } from "../helpers/context.js";
import { TEST_API_KEY } from "../helpers/fakes.js";

describe("CredentialService", () => {
  it("prefers the environment variable over the stored key", async () => {
    const env = createTestEnvironment({ env: { GEMINI_API_KEY: "env-key-0123456789" } });
    await env.keyring.set("gemini", "stored-key-0123456789");
    await expect(env.ctx.credentials.resolve("gemini")).resolves.toEqual({
      apiKey: "env-key-0123456789",
      source: "env"
    });
    env.cleanup();
  });

  it("falls back to the configured backend and reports its source", async () => {
    const env = createTestEnvironment();
    await env.keyring.set("gemini", TEST_API_KEY);
    await expect(env.ctx.credentials.resolve("gemini")).resolves.toEqual({ apiKey: TEST_API_KEY, source: "keyring" });
    env.cleanup();
  });

  it("ignores a blank environment variable", async () => {
    const env = createTestEnvironment({ env: { GEMINI_API_KEY: "   " } });
    expect((await env.ctx.credentials.inspect("gemini")).source).toBe("none");
    env.cleanup();
  });

  it("throws MISSING_API_KEY with guidance when nothing is configured", async () => {
    const env = createTestEnvironment();
    await expect(env.ctx.credentials.resolve("gemini")).rejects.toMatchObject({
      code: "MISSING_API_KEY",
      hint: expect.stringContaining("GEMINI_API_KEY")
    });
    env.cleanup();
  });

  it("inspect reports a store problem instead of throwing", async () => {
    const env = createTestEnvironment();
    env.keyring.unavailable = true;
    const inspection = await env.ctx.credentials.inspect("gemini");
    expect(inspection.source).toBe("none");
    expect(inspection.problem?.code).toBe("CREDENTIAL_STORE_UNAVAILABLE");
    env.cleanup();
  });

  it("never silently switches backends when the keychain is unavailable", async () => {
    const env = createTestEnvironment();
    env.keyring.unavailable = true;
    await expect(env.ctx.credentials.save("gemini", TEST_API_KEY)).rejects.toMatchObject({
      code: "CREDENTIAL_STORE_UNAVAILABLE"
    });
    await expect(env.ctx.credentials.inspect("gemini")).resolves.toMatchObject({ source: "none" });
    env.cleanup();
  });

  it("remove clears keys from every backend and reports unreachable ones", async () => {
    const env = createTestEnvironment();
    await env.ctx.credentials.save("gemini", TEST_API_KEY, "file");
    await env.ctx.credentials.save("gemini", TEST_API_KEY, "keyring");
    expect(await env.ctx.credentials.remove("gemini")).toEqual([]);
    expect(env.keyring.entries.size).toBe(0);

    env.keyring.unavailable = true;
    const problems = await env.ctx.credentials.remove("gemini");
    expect(problems).toHaveLength(1);
    env.cleanup();
  });
});

describe("SettingsResolver precedence", () => {
  it("falls back to built-in defaults", async () => {
    const env = createTestEnvironment();
    await expect(env.ctx.settings.resolve()).resolves.toEqual({
      providerId: "gemini",
      model: "fake-model",
      aiEnabled: undefined
    });
    env.cleanup();
  });

  it("orders flag > EXPRESSFORGE_MODEL > provider variable > config > default", async () => {
    const env = createTestEnvironment({
      env: { EXPRESSFORGE_MODEL: "from-generic-env", GEMINI_MODEL: "from-provider-env" }
    });
    await env.ctx.config.setProviderModel("gemini", "from-config");

    expect((await env.ctx.settings.resolve({ model: "from-flag" })).model).toBe("from-flag");
    expect((await env.ctx.settings.resolve()).model).toBe("from-generic-env");
    env.cleanup();

    const providerEnv = createTestEnvironment({ env: { GEMINI_MODEL: "from-provider-env" } });
    await providerEnv.ctx.config.setProviderModel("gemini", "from-config");
    expect((await providerEnv.ctx.settings.resolve()).model).toBe("from-provider-env");
    providerEnv.cleanup();

    const configOnly = createTestEnvironment();
    await configOnly.ctx.config.setProviderModel("gemini", "from-config");
    expect((await configOnly.ctx.settings.resolve()).model).toBe("from-config");
    configOnly.cleanup();
  });

  it("orders provider flag > EXPRESSFORGE_PROVIDER > config", async () => {
    const env = createTestEnvironment({ env: { EXPRESSFORGE_PROVIDER: "gemini" } });
    await env.ctx.config.update({ defaultProvider: "missing" });
    expect((await env.ctx.settings.resolve({ provider: "gemini" })).providerId).toBe("gemini");
    expect((await env.ctx.settings.resolve()).providerId).toBe("gemini");
    env.cleanup();

    const configured = createTestEnvironment();
    await configured.ctx.config.update({ defaultProvider: "unknown" });
    await expect(configured.ctx.settings.resolve()).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER" });
    configured.cleanup();
  });
});
