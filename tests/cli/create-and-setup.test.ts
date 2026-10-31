import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/presentation/cli/run.js";
import { ExpressForgeError } from "../../src/shared/errors.js";
import { createTestEnvironment, type TestEnvironment } from "../helpers/context.js";
import {
  cancelled,
  invalidKeyError,
  TEST_API_KEY,
  VALID_SPEC,
  type Answer,
  type FakeProviderBehavior
} from "../helpers/fakes.js";

const environments: TestEnvironment[] = [];
const setup = (options: Parameters<typeof createTestEnvironment>[0] = {}) => {
  const env = createTestEnvironment(options);
  environments.push(env);
  return env;
};
afterEach(() => environments.splice(0).forEach((env) => env.cleanup()));

const run = (env: TestEnvironment, ...args: string[]) => runCli(args, env.ctx);
const projectDir = (env: TestEnvironment, name: string) => path.join(env.cwd, name);
const exists = (env: TestEnvironment, name: string) => fs.existsSync(projectDir(env, name));
const BAD_KEY = "bad-key-0123456789";
const rejectBadKey = (apiKey: string) => {
  if (apiKey === BAD_KEY) throw invalidKeyError();
};

// Wizard answers in order: name, [description], language, database, [use AI?, approve?], install?
describe("first-run configuration", () => {
  it("lets the user decline AI and continue with a no-AI project", async () => {
    const env = setup({ answers: [false, "plain-app", "typescript", "none", false] });
    expect(await run(env)).toBe(0);
    expect(env.prompter.asked[0]).toMatch(/Enable AI-powered project analysis/);
    expect(env.prompter.asked.some((message) => /describe/i.test(message))).toBe(false);
    expect(exists(env, "plain-app")).toBe(true);
    expect((await env.ctx.config.get()).aiEnabled).toBe(false);
    expect(env.calls.created).toHaveLength(0);
  });

  it("does not ask again after the user declined", async () => {
    const env = setup({ answers: [false, "one", "typescript", "none", false] });
    await run(env);
    const second = setup({ answers: ["two", "typescript", "none", false] });
    await second.ctx.config.update({ aiEnabled: false });
    expect(await run(second)).toBe(0);
    expect(second.prompter.asked.some((message) => /Enable AI/.test(message))).toBe(false);
  });

  it("verifies and securely stores a key, then uses AI in the same run", async () => {
    const env = setup({
      answers: [
        true,
        TEST_API_KEY,
        "books-api",
        "A bookstore with books and authors",
        "typescript",
        "postgresql",
        true,
        true,
        false
      ]
    });
    expect(await run(env)).toBe(0);

    expect(env.calls.validated).toEqual([TEST_API_KEY]);
    expect(env.keyring.entries.get("gemini")).toBe(TEST_API_KEY);
    expect(await env.ctx.config.get()).toMatchObject({
      aiEnabled: true,
      defaultProvider: "gemini",
      credentialBackend: "keyring"
    });
    expect(env.calls.proposals).toEqual([
      { description: "A bookstore with books and authors", database: "postgresql" }
    ]);
    expect(
      JSON.parse(fs.readFileSync(path.join(projectDir(env, "books-api"), "src/generated/schema.json"), "utf8"))
    ).toEqual(VALID_SPEC);
    expect(env.ui.stdout).toContain("Book (books)");
    expect(env.ui.stdout).toContain("src/generated/schema.json");
  });

  it("never prints the API key", async () => {
    const env = setup({
      answers: [true, TEST_API_KEY, "p", "A bookstore with books and authors", "typescript", "none", true, true, false],
      debug: true
    });
    await run(env);
    expect(env.ui.all).not.toContain(TEST_API_KEY);
    expect(env.prompter.asked.join(" ")).not.toContain(TEST_API_KEY);
  });

  it("explains a rejected key and lets the user retry", async () => {
    const env = setup({
      answers: [
        true,
        BAD_KEY,
        true,
        TEST_API_KEY,
        "retry-app",
        "A bookstore with books and authors",
        "typescript",
        "none",
        false,
        false
      ],
      provider: { validate: rejectBadKey }
    });
    expect(await run(env)).toBe(0);
    expect(env.ui.stderr).toMatch(/rejected the API key/);
    expect(env.ui.stderr).toContain("INVALID_API_KEY");
    expect(env.calls.validated).toEqual([BAD_KEY, TEST_API_KEY]);
    expect(env.keyring.entries.get("gemini")).toBe(TEST_API_KEY);
  });

  it("continues without AI and stores nothing when the user gives up after a bad key", async () => {
    const env = setup({
      answers: [true, BAD_KEY, false, "giveup-app", "typescript", "none", false],
      provider: { validate: rejectBadKey }
    });
    expect(await run(env)).toBe(0);
    expect(env.keyring.entries.size).toBe(0);
    expect((await env.ctx.config.get()).aiEnabled).toBeUndefined();
    expect(exists(env, "giveup-app")).toBe(true);
  });

  it("treats Ctrl+C at a prompt as cancellation and writes nothing", async () => {
    const env = setup({ answers: [cancelled()] });
    expect(await run(env)).toBe(130);
    expect(fs.readdirSync(env.cwd)).toEqual([]);
    expect(env.ui.stderr).toMatch(/Cancelled/);
  });

  it("asks for explicit consent before using the plaintext file fallback", async () => {
    const env = setup({
      answers: [
        true,
        TEST_API_KEY,
        true,
        "fallback-app",
        "A bookstore with books and authors",
        "typescript",
        "none",
        false,
        false
      ]
    });
    env.keyring.unavailable = true;
    expect(await run(env)).toBe(0);
    expect(env.ui.stderr).toMatch(/Security: the API key will be stored unencrypted/);
    expect(env.prompter.asked.some((message) => /Store the API key in that file/.test(message))).toBe(true);
    expect((await env.ctx.config.get()).credentialBackend).toBe("file");
    expect(JSON.parse(fs.readFileSync(path.join(env.configDir, "credentials.json"), "utf8"))).toEqual({
      gemini: TEST_API_KEY
    });
  });

  it("does not store the key anywhere when the user refuses the fallback", async () => {
    const env = setup({ answers: [true, TEST_API_KEY, false, "refused-app", "typescript", "none", false] });
    env.keyring.unavailable = true;
    expect(await run(env)).toBe(0);
    expect(fs.existsSync(path.join(env.configDir, "credentials.json"))).toBe(false);
    expect(env.ui.stdout).toMatch(/not saved/);
  });

  it("skips setup entirely when an environment variable provides the key", async () => {
    const env = setup({
      env: { GEMINI_API_KEY: TEST_API_KEY },
      answers: ["env-app", "A bookstore with books and authors", "typescript", "none", false, false]
    });
    expect(await run(env)).toBe(0);
    expect(env.prompter.asked.some((message) => /Enable AI/.test(message))).toBe(false);
    expect(await env.ctx.config.exists()).toBe(false);
  });

  it("does not ask the first-run question when configuration already exists", async () => {
    const env = setup({
      answers: ["configured", "A bookstore with books and authors", "typescript", "postgresql", true, true, false]
    });
    await env.ctx.setup.persist({ providerId: "gemini", apiKey: TEST_API_KEY });
    expect(await run(env)).toBe(0);
    expect(env.prompter.asked.some((message) => /Enable AI/.test(message))).toBe(false);
    expect(env.calls.proposals).toHaveLength(1);
  });
});

describe("AI proposal approval", () => {
  const configured = (answers: Answer[], provider: FakeProviderBehavior = {}) =>
    setup({ env: { GEMINI_API_KEY: TEST_API_KEY }, answers, provider });

  it("writes nothing when the user rejects the proposal", async () => {
    const env = configured(["rejected", "A bookstore with books and authors", "typescript", "postgresql", true, false]);
    expect(await run(env)).toBe(0);
    expect(env.ui.stderr).toMatch(/Schema rejected/);
    expect(exists(env, "rejected")).toBe(false);
  });

  it("reports provider failures with the right exit code and writes nothing", async () => {
    const env = configured(["failing", "A bookstore with books and authors", "typescript", "postgresql", true], {
      propose: () => {
        throw new ExpressForgeError("RATE_LIMITED", "Rate limit exceeded.", { hint: "Wait." });
      }
    });
    expect(await run(env)).toBe(4);
    expect(env.ui.stderr).toContain("RATE_LIMITED");
    expect(env.ui.spinnerEvents).toContain("fail:AI schema generation failed.");
    expect(exists(env, "failing")).toBe(false);
  });

  it("rejects an invalid AI response before anything is written", async () => {
    const env = configured(["invalid-ai", "A bookstore with books and authors", "typescript", "postgresql", true], {
      propose: () => ({ ...VALID_SPEC, schemaVersion: 7 }) as never
    });
    expect(await run(env)).toBe(4);
    expect(env.ui.stderr).toContain("INVALID_AI_RESPONSE");
    expect(exists(env, "invalid-ai")).toBe(false);
  });

  it("can skip AI even when a key is available", async () => {
    const env = configured(["no-ai-today", "A bookstore with books and authors", "javascript", "mysql", false, false]);
    expect(await run(env)).toBe(0);
    expect(env.calls.proposals).toHaveLength(0);
    expect(
      JSON.parse(fs.readFileSync(path.join(projectDir(env, "no-ai-today"), "src/generated/schema.json"), "utf8"))
        .entities
    ).toEqual([]);
  });

  it("removes generated files if the user cancels (Ctrl+C) right after they were written", async () => {
    let abort = () => {};
    const env = configured(
      ["cancel-late", "A bookstore with books and authors", "typescript", "postgresql", true, true],
      {
        propose: () => {
          abort();
          return VALID_SPEC;
        }
      }
    );
    abort = () => env.abort.abort();
    expect(await run(env)).toBe(130);
    expect(exists(env, "cancel-late")).toBe(false);
  });
});

describe("existing output directory", () => {
  it("fails before any AI call and leaves the directory alone", async () => {
    const env = setup({
      env: { GEMINI_API_KEY: TEST_API_KEY },
      answers: ["taken", "A bookstore with books and authors", "typescript", "postgresql", true]
    });
    fs.mkdirSync(projectDir(env, "taken"));
    expect(await run(env)).toBe(5);
    expect(env.ui.stderr).toContain("PROJECT_EXISTS");
    expect(env.calls.proposals).toHaveLength(0);
    expect(fs.readdirSync(projectDir(env, "taken"))).toEqual([]);
  });
});

describe("non-interactive mode", () => {
  const base = ["create", "--name", "ci-app", "--language", "typescript", "--database", "postgresql"];

  it("generates a project with --no-ai and never prompts", async () => {
    const env = setup({ interactive: false });
    expect(await run(env, ...base, "--no-ai")).toBe(0);
    expect(env.prompter.asked).toEqual([]);
    expect(exists(env, "ci-app")).toBe(true);
    expect(env.installs).toEqual([]);
  });

  it("does not run first-run setup when nothing is configured", async () => {
    const env = setup({ interactive: false });
    expect(await run(env, ...base)).toBe(0);
    expect(env.prompter.asked).toEqual([]);
    expect(env.calls.created).toHaveLength(0);
  });

  it("needs --name unless --yes is given", async () => {
    const env = setup({ interactive: false });
    expect(await run(env, "create", "--language", "typescript", "--database", "none")).toBe(2);
    expect(env.ui.stderr).toContain("--name");
    expect(await run(env, "create", "--yes")).toBe(0);
    expect(exists(env, "my-express-api")).toBe(true);
  });

  it("applies template defaults with --yes", async () => {
    const env = setup({ interactive: false });
    await run(env, "create", "--yes", "--name", "defaults");
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir(env, "defaults"), "package.json"), "utf8"));
    expect(pkg.dependencies).toHaveProperty("pg");
    expect(fs.existsSync(path.join(projectDir(env, "defaults"), "tsconfig.json"))).toBe(true);
  });

  it("requires explicit schema pre-approval for --ai", async () => {
    const env = setup({ interactive: false, env: { GEMINI_API_KEY: TEST_API_KEY } });
    expect(await run(env, ...base, "--ai", "--description", "A bookstore with books and authors")).toBe(2);
    expect(env.ui.stderr).toContain("--approve-schema");
    expect(env.calls.proposals).toHaveLength(0);
    expect(await run(env, ...base, "--ai")).toBe(2);
    expect(env.ui.stderr).toContain("--description");
  });

  it("uses AI when --ai and --approve-schema are given", async () => {
    const env = setup({ interactive: false, env: { GEMINI_API_KEY: TEST_API_KEY } });
    expect(
      await run(env, ...base, "--ai", "--approve-schema", "--description", "A bookstore with books and authors")
    ).toBe(0);
    expect(env.calls.proposals).toHaveLength(1);
    expect(
      JSON.parse(fs.readFileSync(path.join(projectDir(env, "ci-app"), "src/generated/schema.json"), "utf8"))
    ).toEqual(VALID_SPEC);
  });

  it("fails with MISSING_API_KEY (exit 3) when --ai has no credentials", async () => {
    const env = setup({ interactive: false });
    expect(
      await run(env, ...base, "--ai", "--approve-schema", "--description", "A bookstore with books and authors")
    ).toBe(3);
    expect(env.ui.stderr).toContain("MISSING_API_KEY");
    expect(exists(env, "ci-app")).toBe(false);
  });

  it("validates flag values with helpful hints", async () => {
    const env = setup({ interactive: false });
    expect(await run(env, "create", "--name", "x", "--language", "cobol", "--database", "none")).toBe(2);
    expect(env.ui.stderr).toMatch(/typescript, javascript/);
    expect(await run(env, "create", "--name", "../evil", "--language", "typescript", "--database", "none")).toBe(2);
    expect(await run(env, "create", "--name", "ok", "--language", "typescript", "--database", "oracle")).toBe(2);
    expect(fs.readdirSync(env.cwd)).toEqual([]);
  });

  it("installs only when asked, and reports install failure without failing the run", async () => {
    const env = setup({ interactive: false });
    expect(await run(env, ...base, "--no-ai", "--install")).toBe(0);
    expect(env.installs).toEqual([projectDir(env, "ci-app")]);

    const failing = setup({
      interactive: false,
      installer: {
        async install() {
          throw new ExpressForgeError("INSTALL_FAILED", "npm install failed (exit code 1).", {
            hint: "Run npm install yourself."
          });
        }
      }
    });
    expect(await run(failing, ...base, "--no-ai", "--install")).toBe(0);
    expect(failing.ui.stderr).toContain("INSTALL_FAILED");
    expect(exists(failing, "ci-app")).toBe(true);
  });

  it("asks whether to install in interactive mode", async () => {
    const env = setup({ answers: ["inst", "typescript", "none", true], env: {} });
    await env.ctx.setup.decline();
    expect(await run(env)).toBe(0);
    expect(env.installs).toEqual([projectDir(env, "inst")]);
  });
});

describe("usage errors and help", () => {
  it("prints help and version with exit code 0", async () => {
    const env = setup();
    expect(await run(env, "--help")).toBe(0);
    expect(env.ui.stdout).toMatch(/config\s+manage AI provider settings/);
    expect(await run(env, "--version")).toBe(0);
    expect(env.ui.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(await run(env, "create", "--help")).toBe(0);
    expect(env.ui.stdout).toContain("--approve-schema");
  });

  it("exits with 2 for unknown options and commands", async () => {
    const env = setup({ interactive: false });
    expect(await run(env, "create", "--bogus")).toBe(2);
    expect(await run(env, "frobnicate")).toBe(2);
  });

  it("shows technical details only with --debug", async () => {
    const quiet = setup({ interactive: false });
    await run(quiet, "create", "--name", "x", "--language", "cobol", "--database", "none");
    const loud = setup({ interactive: false, debug: true });
    await run(loud, "create", "--name", "x", "--language", "cobol", "--database", "none");
    expect(loud.ui.stderr.length).toBeGreaterThan(quiet.ui.stderr.length);
  });
});
