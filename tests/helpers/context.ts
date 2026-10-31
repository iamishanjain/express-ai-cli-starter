import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { PackageInstaller } from "../../src/application/ports.js";
import { buildContext } from "../../src/composition.js";
import type { ProviderDefinition } from "../../src/domain/ai-provider.js";
import type { CliContext } from "../../src/presentation/context.js";
import {
  CapturingUi,
  fakeProviderDefinition,
  MemoryCredentialStore,
  ScriptedPrompter,
  type Answer,
  type FakeProviderBehavior,
  type FakeProviderCalls
} from "./fakes.js";

export interface TestEnvironment {
  ctx: CliContext;
  ui: CapturingUi;
  prompter: ScriptedPrompter;
  keyring: MemoryCredentialStore;
  calls: FakeProviderCalls;
  installs: string[];
  root: string;
  cwd: string;
  configDir: string;
  abort: AbortController;
  cleanup: () => void;
}

export interface TestEnvironmentOptions {
  answers?: Answer[];
  env?: Record<string, string | undefined>;
  interactive?: boolean;
  provider?: FakeProviderBehavior;
  providers?: ProviderDefinition[];
  installer?: PackageInstaller;
  debug?: boolean;
  templatesRoot?: string;
  stdin?: string;
}

/** The real application wiring with fakes at the edges: no network, no real keychain, no real home directory. */
export function createTestEnvironment(options: TestEnvironmentOptions = {}): TestEnvironment {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "expressforge-test-"));
  const cwd = path.join(root, "work");
  const configDir = path.join(root, "config");
  fs.mkdirSync(cwd, { recursive: true });

  const ui = new CapturingUi();
  const prompter = new ScriptedPrompter(options.answers);
  const keyring = new MemoryCredentialStore("keyring");
  const { definition, calls } = fakeProviderDefinition(options.provider);
  const installs: string[] = [];
  const abort = new AbortController();

  const ctx = buildContext({
    env: options.env ?? {},
    cwd,
    isInteractive: options.interactive ?? true,
    signal: abort.signal,
    debug: options.debug ?? false,
    configDir,
    providers: options.providers ?? [definition],
    credentialStores: { keyring },
    installer: options.installer ?? {
      async install(dir) {
        installs.push(dir);
      }
    },
    stdin: Readable.from(options.stdin === undefined ? [] : [options.stdin]),
    prompter,
    ui,
    templatesRoot: options.templatesRoot
  });

  return {
    ctx,
    ui,
    prompter,
    keyring,
    calls,
    installs,
    root,
    cwd,
    configDir,
    abort,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  };
}
