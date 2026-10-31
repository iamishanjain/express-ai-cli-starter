import type { CredentialStore } from "../../src/application/ports.js";
import type { AIProvider, ProviderDefinition, ProviderMetadata } from "../../src/domain/ai-provider.js";
import type { ProjectSpec } from "../../src/domain/project-spec.js";
import type { Prompter } from "../../src/presentation/prompts/prompter.js";
import type { Spinner, Ui } from "../../src/presentation/ui/ui.js";
import { ExpressForgeError } from "../../src/shared/errors.js";

export const VALID_SPEC: ProjectSpec = {
  schemaVersion: 1,
  projectSummary: "A small bookstore API.",
  entities: [
    {
      name: "Book",
      tableName: "books",
      description: "A book for sale.",
      fields: [
        { name: "id", type: "uuid", nullable: false, unique: true, primaryKey: true, description: "Identifier" },
        { name: "title", type: "string", nullable: false, unique: false, primaryKey: false, description: "Title" }
      ]
    }
  ],
  suggestedModules: ["auth"],
  assumptions: ["Authors are stored as plain text."]
};

export const TEST_API_KEY = "AIzaSyTESTKEY0123456789abcdefghijklmnop";

/** Collects everything the CLI prints. */
export class CapturingUi implements Ui {
  readonly out: string[] = [];
  readonly err: string[] = [];
  readonly spinnerEvents: string[] = [];

  write(text: string): void {
    this.out.push(text);
  }
  writeError(text: string): void {
    this.err.push(text);
  }
  line(text = ""): void {
    this.out.push(`${text}\n`);
  }
  heading(text: string): void {
    this.out.push(`${text}\n`);
  }
  info(text: string): void {
    this.out.push(`${text}\n`);
  }
  success(text: string): void {
    this.out.push(`✔ ${text}\n`);
  }
  warn(text: string): void {
    this.err.push(`⚠ ${text}\n`);
  }
  error(text: string): void {
    this.err.push(`${text}\n`);
  }
  spinner(text: string): Spinner {
    this.spinnerEvents.push(`start:${text}`);
    return {
      succeed: (message) => void this.spinnerEvents.push(`succeed:${message ?? text}`),
      fail: (message) => void this.spinnerEvents.push(`fail:${message ?? text}`),
      stop: () => void this.spinnerEvents.push("stop")
    };
  }
  get stdout(): string {
    return this.out.join("");
  }
  get stderr(): string {
    return this.err.join("");
  }
  get all(): string {
    return this.stdout + this.stderr + this.spinnerEvents.join("\n");
  }
}

export type Answer = string | boolean | Error;

/** Answers prompts from a script and records what was asked. Fails loudly on unexpected prompts. */
export class ScriptedPrompter implements Prompter {
  readonly asked: string[] = [];
  private readonly answers: Answer[];

  constructor(answers: Answer[] = []) {
    this.answers = [...answers];
  }

  get remaining(): number {
    return this.answers.length;
  }

  private next(message: string): string | boolean {
    this.asked.push(message);
    const answer = this.answers.shift();
    if (answer === undefined) throw new Error(`Unexpected prompt: ${message}`);
    if (answer instanceof Error) throw answer;
    return answer;
  }

  async input(options: { message: string; validate?: (value: string) => true | string }): Promise<string> {
    const value = String(this.next(options.message));
    const verdict = options.validate?.(value);
    if (verdict !== undefined && verdict !== true) throw new Error(`Scripted answer rejected by validate: ${verdict}`);
    return value;
  }
  async password(options: { message: string; validate?: (value: string) => true | string }): Promise<string> {
    return this.input(options);
  }
  async confirm(options: { message: string }): Promise<boolean> {
    return Boolean(this.next(options.message));
  }
  async select<T>(options: { message: string }): Promise<T> {
    return this.next(options.message) as T;
  }
}

export const cancelled = (): ExpressForgeError => new ExpressForgeError("CANCELLED", "Cancelled.");

export class MemoryCredentialStore implements CredentialStore {
  readonly entries = new Map<string, string>();
  unavailable = false;

  constructor(readonly backend: "keyring" | "file" = "keyring") {}

  private check(): void {
    if (this.unavailable) {
      throw new ExpressForgeError(
        "CREDENTIAL_STORE_UNAVAILABLE",
        "The operating system credential store is not available."
      );
    }
  }
  async get(providerId: string): Promise<string | undefined> {
    this.check();
    return this.entries.get(providerId);
  }
  async set(providerId: string, secret: string): Promise<void> {
    this.check();
    this.entries.set(providerId, secret);
  }
  async delete(providerId: string): Promise<void> {
    this.check();
    this.entries.delete(providerId);
  }
}

export const FAKE_METADATA: ProviderMetadata = {
  id: "gemini",
  displayName: "Fake Gemini",
  envVar: "GEMINI_API_KEY",
  modelEnvVar: "GEMINI_MODEL",
  defaultModel: "fake-model",
  credentialHint: "Get a key from the fake console."
};

export interface FakeProviderBehavior {
  validate?: (apiKey: string) => Promise<void> | void;
  propose?: (input: { description: string; database: string }) => Promise<ProjectSpec> | ProjectSpec;
  models?: () => Promise<{ id: string }[]> | { id: string }[];
}

export interface FakeProviderCalls {
  created: { apiKey: string; model: string; timeoutMs: number }[];
  validated: string[];
  proposals: { description: string; database: string }[];
}

/** A provider definition whose behavior and call log tests control. */
export function fakeProviderDefinition(
  behavior: FakeProviderBehavior = {},
  metadata: ProviderMetadata = FAKE_METADATA
): { definition: ProviderDefinition; calls: FakeProviderCalls } {
  const calls: FakeProviderCalls = { created: [], validated: [], proposals: [] };
  const definition: ProviderDefinition = {
    metadata,
    create(context) {
      calls.created.push({ apiKey: context.apiKey, model: context.model, timeoutMs: context.timeoutMs });
      const provider: AIProvider = {
        metadata,
        async validateCredentials() {
          calls.validated.push(context.apiKey);
          await behavior.validate?.(context.apiKey);
        },
        async proposeProjectSpec(input) {
          calls.proposals.push({ ...input });
          return behavior.propose ? behavior.propose(input) : VALID_SPEC;
        },
        ...(behavior.models ? { listModels: async () => behavior.models!() } : {})
      };
      return provider;
    }
  };
  return { definition, calls };
}

export const invalidKeyError = (): ExpressForgeError =>
  new ExpressForgeError("INVALID_API_KEY", "Fake Gemini rejected the API key.", {
    hint: "Run `expressforge config set`."
  });
