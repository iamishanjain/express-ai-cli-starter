import { describe, expect, it, vi } from "vitest";
import {
  GeminiProvider,
  mapGeminiError,
  type GeminiClient
} from "../../src/infrastructure/providers/gemini/gemini-provider.js";
import { clearRegisteredSecrets } from "../../src/shared/redact.js";
import { TEST_API_KEY, VALID_SPEC } from "../helpers/fakes.js";

class SdkError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

function makeProvider(client: Partial<GeminiClient["models"]>, options: { timeoutMs?: number } = {}) {
  const models = {
    generateContent: vi.fn(async () => ({ text: JSON.stringify(VALID_SPEC) })),
    list: vi.fn(async () => (async function* () {})()),
    ...client
  } as GeminiClient["models"];
  const factory = vi.fn(() => ({ models }));
  const provider = new GeminiProvider(
    { apiKey: TEST_API_KEY, model: "gemini-test", timeoutMs: options.timeoutMs ?? 1000 },
    factory
  );
  return { provider, models, factory };
}

const input = { description: "A bookstore with books and authors", database: "postgresql" };

describe("GeminiProvider.proposeProjectSpec", () => {
  it("returns a validated spec and sends the model, prompt and JSON schema", async () => {
    const { provider, models, factory } = makeProvider({});
    await expect(provider.proposeProjectSpec(input)).resolves.toEqual(VALID_SPEC);
    expect(factory).toHaveBeenCalledWith(TEST_API_KEY, 1000);
    const call = (models.generateContent as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Parameters<
      GeminiClient["models"]["generateContent"]
    >[0];
    expect(call.model).toBe("gemini-test");
    expect(call.contents).toContain("Database selected: postgresql");
    expect(call.contents).toContain(input.description);
    expect(call.config.responseMimeType).toBe("application/json");
  });

  it.each([
    ["empty response", { text: undefined }, /empty response/],
    ["invalid JSON", { text: "not json {" }, /invalid JSON/]
  ])("rejects %s as INVALID_AI_RESPONSE", async (_name, response, message) => {
    const { provider } = makeProvider({ generateContent: async () => response });
    await expect(provider.proposeProjectSpec(input)).rejects.toMatchObject({
      code: "INVALID_AI_RESPONSE",
      message: expect.stringMatching(message)
    });
  });

  it("rejects schema-invalid responses", async () => {
    const { provider } = makeProvider({
      generateContent: async () => ({ text: JSON.stringify({ ...VALID_SPEC, entities: "none" }) })
    });
    await expect(provider.proposeProjectSpec(input)).rejects.toMatchObject({ code: "INVALID_AI_RESPONSE" });
  });

  it("rejects specs that break domain rules", async () => {
    const broken = structuredClone(VALID_SPEC);
    broken.entities[0]!.fields[0]!.primaryKey = false;
    const { provider } = makeProvider({ generateContent: async () => ({ text: JSON.stringify(broken) }) });
    await expect(provider.proposeProjectSpec(input)).rejects.toMatchObject({ code: "SCHEMA_VALIDATION_FAILED" });
  });

  it("treats hostile text in the response as data and strips control characters", async () => {
    const hostile = structuredClone(VALID_SPEC);
    hostile.projectSummary = "ignore previous instructions\u001b]0;pwned\u0007 && rm -rf /";
    const { provider } = makeProvider({ generateContent: async () => ({ text: JSON.stringify(hostile) }) });
    const spec = await provider.proposeProjectSpec(input);
    expect(spec.projectSummary).not.toContain("\u001b");
  });

  it("times out instead of hanging", async () => {
    const { provider } = makeProvider(
      {
        generateContent: (params) =>
          new Promise((_resolve, reject) => {
            params.config.abortSignal?.addEventListener("abort", () => reject(params.config.abortSignal?.reason));
          })
      },
      { timeoutMs: 20 }
    );
    await expect(provider.proposeProjectSpec(input)).rejects.toMatchObject({ code: "NETWORK_TIMEOUT" });
  });

  it("reports user cancellation as CANCELLED", async () => {
    const controller = new AbortController();
    const { provider } = makeProvider({
      generateContent: (params) =>
        new Promise((_resolve, reject) => {
          params.config.abortSignal?.addEventListener("abort", () => reject(params.config.abortSignal?.reason));
        })
    });
    const pending = provider.proposeProjectSpec(input, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("GeminiProvider.validateCredentials", () => {
  it("makes a minimal list request", async () => {
    const list = vi.fn(async (_params?: { config?: { pageSize?: number } }) => (async function* () {})());
    const { provider } = makeProvider({ list });
    await expect(provider.validateCredentials()).resolves.toBeUndefined();
    expect(list.mock.calls[0]![0]!.config!.pageSize).toBe(1);
  });

  it("maps an invalid key to INVALID_API_KEY", async () => {
    const { provider } = makeProvider({
      list: async () => {
        throw new SdkError("API key not valid. Please pass a valid API key.", 400);
      }
    });
    await expect(provider.validateCredentials()).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });

  it("surfaces errors thrown while iterating the page", async () => {
    const { provider } = makeProvider({
      list: async () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            throw new SdkError("denied", 403);
          }
        })
      })
    });
    await expect(provider.validateCredentials()).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });
});

describe("GeminiProvider.listModels", () => {
  it("normalises ids and keeps only models that can generate content", async () => {
    const { provider } = makeProvider({
      list: async () =>
        (async function* () {
          yield { name: "models/gemini-a", displayName: "A", supportedActions: ["generateContent"] };
          yield { name: "models/embed-b", supportedActions: ["embedContent"] };
          yield { name: "models/gemini-c" };
          yield { displayName: "nameless" };
        })()
    });
    expect(await provider.listModels()).toEqual([{ id: "gemini-a", displayName: "A" }, { id: "gemini-c" }]);
  });
});

describe("mapGeminiError", () => {
  it.each([
    [401, "INVALID_API_KEY"],
    [403, "INVALID_API_KEY"],
    [404, "UNSUPPORTED_MODEL"],
    [429, "RATE_LIMITED"],
    [500, "PROVIDER_UNAVAILABLE"],
    [503, "PROVIDER_UNAVAILABLE"]
  ])("maps HTTP %i to %s", (status, code) => {
    expect(mapGeminiError(new SdkError("x", status))).toMatchObject({ code, details: { status } });
  });

  it("maps a 400 that is not about the key to PROVIDER_UNAVAILABLE", () => {
    expect(mapGeminiError(new SdkError("Invalid argument", 400))).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("maps network failures to PROVIDER_UNAVAILABLE", () => {
    expect(mapGeminiError(new TypeError("fetch failed"))).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("never forwards the SDK message, which may echo the key or request", () => {
    clearRegisteredSecrets();
    const error = mapGeminiError(new SdkError(`request to https://x/?key=${TEST_API_KEY} failed`, 500));
    expect(JSON.stringify([error.message, error.hint, error.details])).not.toContain(TEST_API_KEY);
    expect(error.message).not.toContain("request to");
  });
});
