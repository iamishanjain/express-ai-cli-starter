import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../src/application/provider-registry.js";
import { createTestEnvironment } from "../helpers/context.js";
import { FAKE_METADATA, fakeProviderDefinition, TEST_API_KEY } from "../helpers/fakes.js";

describe("ProviderRegistry", () => {
  it("registers, lists and resolves providers", () => {
    const registry = new ProviderRegistry();
    const { definition } = fakeProviderDefinition();
    registry.register(definition);
    expect(registry.has("gemini")).toBe(true);
    expect(registry.get("gemini")).toBe(definition);
    expect(registry.ids()).toEqual(["gemini"]);
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects duplicate registrations", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProviderDefinition().definition);
    expect(() => registry.register(fakeProviderDefinition().definition)).toThrowError(/registered twice/);
  });

  it("reports unknown providers with the available ids", () => {
    const registry = new ProviderRegistry().register(fakeProviderDefinition().definition);
    expect(() => registry.get("openai")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_PROVIDER", hint: expect.stringContaining("gemini") })
    );
  });

  it("supports several providers without touching core code", () => {
    const registry = new ProviderRegistry()
      .register(fakeProviderDefinition().definition)
      .register(fakeProviderDefinition({}, { ...FAKE_METADATA, id: "other", envVar: "OTHER_KEY" }).definition);
    expect(registry.ids()).toEqual(["gemini", "other"]);
  });
});

describe("ProviderFactory", () => {
  it("uses an explicit key and the provider's default model", async () => {
    const env = createTestEnvironment();
    await env.ctx.factory.create("gemini", { apiKey: TEST_API_KEY });
    expect(env.calls.created).toEqual([{ apiKey: TEST_API_KEY, model: "fake-model", timeoutMs: 60_000 }]);
    env.cleanup();
  });

  it("resolves the key from credentials and honours model and timeout", async () => {
    const env = createTestEnvironment({ env: { GEMINI_API_KEY: TEST_API_KEY } });
    await env.ctx.factory.create("gemini", { model: "custom", timeoutMs: 5 });
    expect(env.calls.created).toEqual([{ apiKey: TEST_API_KEY, model: "custom", timeoutMs: 5 }]);
    env.cleanup();
  });

  it("fails with MISSING_API_KEY when nothing is configured", async () => {
    const env = createTestEnvironment();
    await expect(env.ctx.factory.create("gemini")).rejects.toMatchObject({ code: "MISSING_API_KEY" });
    env.cleanup();
  });

  it("fails with UNSUPPORTED_PROVIDER for unknown ids", async () => {
    const env = createTestEnvironment();
    await expect(env.ctx.factory.create("nope")).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER" });
    env.cleanup();
  });
});
