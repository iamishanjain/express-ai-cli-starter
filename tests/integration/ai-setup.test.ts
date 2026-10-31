import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeProject } from "../../src/application/analyze-project.js";
import { createTestEnvironment, type TestEnvironment } from "../helpers/context.js";
import { invalidKeyError, TEST_API_KEY, VALID_SPEC } from "../helpers/fakes.js";

const environments: TestEnvironment[] = [];
const setup = (options: Parameters<typeof createTestEnvironment>[0] = {}) => {
  const env = createTestEnvironment(options);
  environments.push(env);
  return env;
};
afterEach(() => environments.splice(0).forEach((env) => env.cleanup()));

describe("AiSetupService", () => {
  it("verifies a key through the provider without storing anything", async () => {
    const env = setup();
    await env.ctx.setup.verify("gemini", TEST_API_KEY);
    expect(env.calls.validated).toEqual([TEST_API_KEY]);
    expect(env.keyring.entries.size).toBe(0);
    expect(await env.ctx.config.exists()).toBe(false);
  });

  it("propagates a rejected key and stores nothing", async () => {
    const env = setup({ provider: { validate: () => Promise.reject(invalidKeyError()) } });
    await expect(env.ctx.setup.verify("gemini", "bad-key-0123456")).rejects.toMatchObject({ code: "INVALID_API_KEY" });
    expect(env.keyring.entries.size).toBe(0);
  });

  it("persists the key in the keychain and keeps it out of the config file", async () => {
    const env = setup();
    const backend = await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY, model: "fake-model-2" });
    expect(backend).toBe("keyring");
    expect(env.keyring.entries.get("gemini")).toBe(TEST_API_KEY);

    const config = fs.readFileSync(path.join(env.configDir, "config.json"), "utf8");
    expect(config).not.toContain(TEST_API_KEY);
    expect(JSON.parse(config)).toMatchObject({
      aiEnabled: true,
      defaultProvider: "gemini",
      credentialBackend: "keyring",
      providers: { gemini: { model: "fake-model-2" } }
    });
    expect(fs.existsSync(path.join(env.configDir, "credentials.json"))).toBe(false);
  });

  it("uses the file backend only when asked and records the choice", async () => {
    const env = setup();
    const backend = await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY, backend: "file" });
    expect(backend).toBe("file");
    expect(env.keyring.entries.size).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(env.configDir, "credentials.json"), "utf8"))).toEqual({
      gemini: TEST_API_KEY
    });
    expect((await env.ctx.config.get()).credentialBackend).toBe("file");
    expect(await env.ctx.credentials.resolve("gemini")).toEqual({ apiKey: TEST_API_KEY, source: "file" });
  });

  it("surfaces an unavailable keychain instead of falling back by itself", async () => {
    const env = setup();
    env.keyring.unavailable = true;
    await expect(env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY })).rejects.toMatchObject({
      code: "CREDENTIAL_STORE_UNAVAILABLE"
    });
    expect(fs.existsSync(path.join(env.configDir, "credentials.json"))).toBe(false);
    expect(await env.ctx.config.exists()).toBe(false);
  });

  it("remembers a declined first-run question", async () => {
    const env = setup();
    await env.ctx.setup.decline();
    expect((await env.ctx.config.get()).aiEnabled).toBe(false);
  });

  it("removeAll deletes keys from every backend and the config file", async () => {
    const env = setup();
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY });
    await env.ctx.credentials.save("gemini", TEST_API_KEY, "file");
    expect(await env.ctx.setup.removeAll()).toEqual([]);
    expect(env.keyring.entries.size).toBe(0);
    expect(await env.ctx.config.exists()).toBe(false);
    expect((await env.ctx.credentials.inspect("gemini")).source).toBe("none");
  });

  describe("checkModel", () => {
    it("accepts a listed model", async () => {
      const env = setup({ env: { GEMINI_API_KEY: TEST_API_KEY }, provider: { models: () => [{ id: "good" }] } });
      await expect(env.ctx.setup.checkModel("gemini", "good")).resolves.toEqual({ checked: true });
    });

    it("rejects an unlisted model with UNSUPPORTED_MODEL", async () => {
      const env = setup({ env: { GEMINI_API_KEY: TEST_API_KEY }, provider: { models: () => [{ id: "good" }] } });
      await expect(env.ctx.setup.checkModel("gemini", "bad")).rejects.toMatchObject({ code: "UNSUPPORTED_MODEL" });
    });

    it("fails open when the model list cannot be fetched", async () => {
      const env = setup({
        env: { GEMINI_API_KEY: TEST_API_KEY },
        provider: { models: () => Promise.reject(new Error("network down")) }
      });
      await expect(env.ctx.setup.checkModel("gemini", "anything")).resolves.toEqual({ checked: false });
    });

    it("does not fail open on an invalid key", async () => {
      const env = setup({
        env: { GEMINI_API_KEY: TEST_API_KEY },
        provider: { models: () => Promise.reject(invalidKeyError()) }
      });
      await expect(env.ctx.setup.checkModel("gemini", "m")).rejects.toMatchObject({ code: "INVALID_API_KEY" });
    });

    it("reports unchecked when the provider cannot list models", async () => {
      const env = setup({ env: { GEMINI_API_KEY: TEST_API_KEY } });
      await expect(env.ctx.setup.checkModel("gemini", "m")).resolves.toEqual({ checked: false });
    });
  });
});

describe("analyzeProject", () => {
  it("returns the validated proposal", async () => {
    const env = setup({ env: { GEMINI_API_KEY: TEST_API_KEY } });
    const provider = await env.ctx.factory.create("gemini");
    await expect(analyzeProject(provider, { description: "x".repeat(20), database: "mysql" })).resolves.toEqual(
      VALID_SPEC
    );
    expect(env.calls.proposals).toEqual([{ description: "x".repeat(20), database: "mysql" }]);
  });

  it("re-validates even when an adapter returns unvalidated data", async () => {
    const env = setup({
      env: { GEMINI_API_KEY: TEST_API_KEY },
      provider: { propose: () => ({ ...VALID_SPEC, entities: [{ ...VALID_SPEC.entities[0]!, name: "lowercase" }] }) }
    });
    const provider = await env.ctx.factory.create("gemini");
    await expect(analyzeProject(provider, { description: "x".repeat(20), database: "mysql" })).rejects.toMatchObject({
      code: "INVALID_AI_RESPONSE"
    });
  });
});
