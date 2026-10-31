import { describe, expect, it, vi } from "vitest";

const constructed: unknown[] = [];

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { list: async () => (async function* () {})(), generateContent: async () => ({ text: "{}" }) };
    constructor(options: unknown) {
      constructed.push(options);
    }
  }
}));

describe("default SDK wiring", () => {
  it("builds the real client with the API key and the request timeout", async () => {
    const { geminiDefinition } = await import("../../src/infrastructure/providers/gemini/gemini-provider.js");
    const provider = geminiDefinition.create({ apiKey: "sdk-key-0123456789", model: "m", timeoutMs: 1234 });
    await provider.validateCredentials();
    expect(constructed).toEqual([{ apiKey: "sdk-key-0123456789", httpOptions: { timeout: 1234 } }]);
  });
});
