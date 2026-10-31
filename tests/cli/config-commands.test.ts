import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/presentation/cli/run.js";
import { createTestEnvironment, type TestEnvironment } from "../helpers/context.js";
import { cancelled, invalidKeyError, TEST_API_KEY } from "../helpers/fakes.js";

const environments: TestEnvironment[] = [];
const setup = (options: Parameters<typeof createTestEnvironment>[0] = {}) => {
  const env = createTestEnvironment(options);
  environments.push(env);
  return env;
};
afterEach(() => environments.splice(0).forEach((env) => env.cleanup()));
const run = (env: TestEnvironment, ...args: string[]) => runCli(args, env.ctx);

describe("config show / get", () => {
  it("reports an unconfigured state", async () => {
    const env = setup();
    expect(await run(env, "config")).toBe(0);
    expect(env.ui.stdout).toContain("not configured yet");
    expect(env.ui.stdout).toContain("API key:            not set");
  });

  it("describes where the key comes from without revealing it", async () => {
    const env = setup();
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY });
    expect(await run(env, "config", "show")).toBe(0);
    expect(env.ui.stdout).toContain("stored in the OS credential store");
    expect(env.ui.all).not.toContain(TEST_API_KEY);

    const fromEnv = setup({ env: { GEMINI_API_KEY: TEST_API_KEY } });
    await run(fromEnv, "config", "show");
    expect(fromEnv.ui.stdout).toContain("provided by GEMINI_API_KEY");
    expect(fromEnv.ui.all).not.toContain(TEST_API_KEY);
  });

  it("supports JSON output", async () => {
    const env = setup();
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY, model: "m1" });
    await run(env, "config", "show", "--json");
    const parsed = JSON.parse(env.ui.stdout);
    expect(parsed).toMatchObject({
      aiEnabled: true,
      provider: "gemini",
      model: "m1",
      credentialBackend: "keyring",
      apiKey: "keyring"
    });
    expect(env.ui.stdout).not.toContain(TEST_API_KEY);
  });

  it("gets individual settings", async () => {
    const env = setup();
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY, model: "m1" });
    for (const [key, expected] of [
      ["provider", "gemini"],
      ["model", "m1"],
      ["ai", "true"],
      ["backend", "keyring"]
    ] as const) {
      env.ui.out.length = 0;
      expect(await run(env, "config", "get", key)).toBe(0);
      expect(env.ui.stdout.trim()).toBe(expected);
    }
    env.ui.out.length = 0;
    await run(env, "config", "get", "path");
    expect(env.ui.stdout.trim()).toBe(path.join(env.configDir, "config.json"));
  });

  it("refuses to read an API key back and rejects unknown keys", async () => {
    const env = setup();
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY });
    expect(await run(env, "config", "get", "api-key")).toBe(2);
    expect(env.ui.stderr).toMatch(/never be read back/);
    expect(env.ui.all).not.toContain(TEST_API_KEY);
    expect(await run(env, "config", "get", "nonsense")).toBe(2);
  });
});

describe("config set", () => {
  it("prompts for a masked key, verifies it and stores it", async () => {
    const env = setup({ answers: [TEST_API_KEY] });
    expect(await run(env, "config", "set")).toBe(0);
    expect(env.calls.validated).toEqual([TEST_API_KEY]);
    expect(env.keyring.entries.get("gemini")).toBe(TEST_API_KEY);
    expect(env.ui.stdout).toContain("API key saved (in the OS credential store)");
    expect(env.ui.all).not.toContain(TEST_API_KEY);
  });

  it("replaces an existing key", async () => {
    const env = setup({ answers: ["replacement-key-0123456789"] });
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY });
    expect(await run(env, "config", "set")).toBe(0);
    expect(env.keyring.entries.get("gemini")).toBe("replacement-key-0123456789");
  });

  it("keeps the old key when the new one is rejected and the user gives up", async () => {
    const env = setup({
      answers: ["bad-key-0123456789", false],
      provider: {
        validate: (key) => {
          if (key.startsWith("bad")) throw invalidKeyError();
        }
      }
    });
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY });
    expect(await run(env, "config", "set")).toBe(0);
    expect(env.keyring.entries.get("gemini")).toBe(TEST_API_KEY);
    expect(env.ui.stdout).toContain("No changes were made");
  });

  it("stores the key in the 0600 file only with --insecure-file-storage", async () => {
    const env = setup({ answers: [TEST_API_KEY] });
    expect(await run(env, "config", "set", "--insecure-file-storage")).toBe(0);
    expect(env.ui.stderr).toMatch(/stored unencrypted/);
    expect(env.keyring.entries.size).toBe(0);
    expect((await env.ctx.config.get()).credentialBackend).toBe("file");
    if (process.platform !== "win32") {
      expect(fs.statSync(path.join(env.configDir, "credentials.json")).mode & 0o777).toBe(0o600);
    }
  });

  it("updates only the model when --model is given (checked against the provider)", async () => {
    const env = setup({ env: { GEMINI_API_KEY: TEST_API_KEY }, provider: { models: () => [{ id: "fast" }] } });
    expect(await run(env, "config", "set", "--model", "fast")).toBe(0);
    expect(env.prompter.asked).toEqual([]);
    expect((await env.ctx.config.get()).providers.gemini?.model).toBe("fast");

    expect(await run(env, "config", "set", "--model", "ghost")).toBe(3);
    expect(env.ui.stderr).toContain("UNSUPPORTED_MODEL");
    expect((await env.ctx.config.get()).providers.gemini?.model).toBe("fast");
  });

  it("saves a model without a key but warns it could not be checked", async () => {
    const env = setup({ interactive: false });
    expect(await run(env, "config", "set", "--model", "later")).toBe(0);
    expect(env.ui.stderr).toMatch(/could not be checked/);
    expect((await env.ctx.config.get()).providers.gemini?.model).toBe("later");
  });

  it("refuses unknown providers", async () => {
    const env = setup({ interactive: false });
    expect(await run(env, "config", "set", "--provider", "openai", "--model", "x")).toBe(3);
    expect(env.ui.stderr).toContain("UNSUPPORTED_PROVIDER");
  });

  it("needs something to set when prompts are unavailable", async () => {
    const env = setup({ interactive: false });
    expect(await run(env, "config", "set")).toBe(2);
    expect(env.ui.stderr).toContain("Nothing to set");
  });

  it("can be cancelled at the key prompt", async () => {
    const env = setup({ answers: [cancelled()] });
    expect(await run(env, "config", "set")).toBe(130);
    expect(env.keyring.entries.size).toBe(0);
  });
});

describe("config validate", () => {
  it("confirms a working key and names its source", async () => {
    const env = setup({ env: { GEMINI_API_KEY: TEST_API_KEY } });
    expect(await run(env, "config", "validate")).toBe(0);
    expect(env.ui.spinnerEvents.at(-1)).toMatch(/valid \(provided by GEMINI_API_KEY\)/);
    expect(env.ui.all).not.toContain(TEST_API_KEY);
  });

  it("reports a rejected key with exit code 3", async () => {
    const env = setup({
      env: { GEMINI_API_KEY: "rejected-key-0123456" },
      provider: { validate: () => Promise.reject(invalidKeyError()) }
    });
    expect(await run(env, "config", "validate")).toBe(3);
    expect(env.ui.stderr).toContain("INVALID_API_KEY");
    expect(env.ui.all).not.toContain("rejected-key-0123456");
  });

  it("reports a missing key with exit code 3 and guidance", async () => {
    const env = setup();
    expect(await run(env, "config", "validate")).toBe(3);
    expect(env.ui.stderr).toContain("MISSING_API_KEY");
    expect(env.ui.stderr).toContain("expressforge config set");
  });
});

describe("config remove", () => {
  it("removes configuration and keys after confirmation", async () => {
    const env = setup({ answers: [true] });
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY });
    expect(await run(env, "config", "remove")).toBe(0);
    expect(env.keyring.entries.size).toBe(0);
    expect(fs.existsSync(path.join(env.configDir, "config.json"))).toBe(false);
    expect(env.ui.stdout).toContain("Environment variables");
  });

  it("does nothing when the user declines", async () => {
    const env = setup({ answers: [false] });
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY });
    expect(await run(env, "config", "remove")).toBe(0);
    expect(env.keyring.entries.size).toBe(1);
    expect(env.ui.stdout).toContain("Nothing was removed");
  });

  it("requires --yes when prompts are unavailable", async () => {
    const env = setup({ interactive: false });
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY });
    expect(await run(env, "config", "remove")).toBe(2);
    expect(env.keyring.entries.size).toBe(1);
    expect(await run(env, "config", "remove", "--yes")).toBe(0);
    expect(env.keyring.entries.size).toBe(0);
  });

  it("still removes the config and warns when the keychain cannot be reached", async () => {
    const env = setup();
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY });
    env.keyring.unavailable = true;
    expect(await run(env, "config", "remove", "--yes")).toBe(0);
    expect(env.ui.stderr).toMatch(/credential store is not available/);
    expect(fs.existsSync(path.join(env.configDir, "config.json"))).toBe(false);
  });
});

describe("providers", () => {
  it("lists the implemented provider", async () => {
    const env = setup();
    expect(await run(env, "providers", "list")).toBe(0);
    expect(env.ui.stdout).toContain("gemini");
    expect(env.ui.stdout).toContain("GEMINI_API_KEY");
    expect(await run(env, "providers")).toBe(0);
  });

  it("supports JSON output with key status", async () => {
    const env = setup({ env: { GEMINI_API_KEY: TEST_API_KEY } });
    await run(env, "providers", "list", "--json");
    expect(JSON.parse(env.ui.stdout)).toEqual([
      {
        id: "gemini",
        name: "Fake Gemini",
        defaultModel: "fake-model",
        apiKeyEnvVar: "GEMINI_API_KEY",
        selected: true,
        credential: "env"
      }
    ]);
    expect(env.ui.stdout).not.toContain(TEST_API_KEY);
  });
});

describe("config set --stdin", () => {
  it("reads the key from standard input, verifies and stores it", async () => {
    const env = setup({ interactive: false, stdin: `${TEST_API_KEY}\n` });
    expect(await run(env, "config", "set", "--stdin")).toBe(0);
    expect(env.calls.validated).toEqual([TEST_API_KEY]);
    expect(env.keyring.entries.get("gemini")).toBe(TEST_API_KEY);
    expect(env.prompter.asked).toEqual([]);
    expect(env.ui.all).not.toContain(TEST_API_KEY);
  });

  it("rejects empty or malformed input without calling the provider", async () => {
    const empty = setup({ interactive: false, stdin: "\n" });
    expect(await run(empty, "config", "set", "--stdin")).toBe(2);
    expect(empty.calls.validated).toEqual([]);

    const spaced = setup({ interactive: false, stdin: "two words here" });
    expect(await run(spaced, "config", "set", "--stdin")).toBe(2);
  });

  it("does not store a key the provider rejects", async () => {
    const env = setup({
      interactive: false,
      stdin: "rejected-key-0123456",
      provider: { validate: () => Promise.reject(invalidKeyError()) }
    });
    expect(await run(env, "config", "set", "--stdin")).toBe(3);
    expect(env.keyring.entries.size).toBe(0);
    expect(env.ui.all).not.toContain("rejected-key-0123456");
  });

  it("fails with guidance, never silently, when the keychain is unavailable and no opt-in was given", async () => {
    const env = setup({ interactive: false, stdin: TEST_API_KEY });
    env.keyring.unavailable = true;
    expect(await run(env, "config", "set", "--stdin")).toBe(3);
    expect(env.ui.stderr).toContain("CREDENTIAL_STORE_UNAVAILABLE");
    expect(fs.existsSync(path.join(env.configDir, "credentials.json"))).toBe(false);
  });

  it("uses the file store when --insecure-file-storage is passed", async () => {
    const env = setup({ interactive: false, stdin: TEST_API_KEY });
    env.keyring.unavailable = true;
    expect(await run(env, "config", "set", "--stdin", "--insecure-file-storage")).toBe(0);
    expect(await env.ctx.credentials.resolve("gemini")).toEqual({ apiKey: TEST_API_KEY, source: "file" });
  });
});
