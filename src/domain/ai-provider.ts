import type { ProjectSpec } from "./project-spec.js";

export interface ProviderMetadata {
  /** Stable identifier used in config files and flags, for example "gemini". */
  readonly id: string;
  readonly displayName: string;
  /** Environment variable that can override the stored credential. */
  readonly envVar: string;
  /** Optional provider-specific variable that overrides the model (kept for backward compatibility). */
  readonly modelEnvVar?: string;
  readonly defaultModel: string;
  /** Where to obtain a key, shown in the setup prompt. */
  readonly credentialHint: string;
}

export interface ModelMetadata {
  readonly id: string;
  readonly displayName?: string;
}

export interface ProjectAnalysisInput {
  readonly description: string;
  readonly database: string;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface AIProvider {
  readonly metadata: ProviderMetadata;
  /** Resolves when the credentials work; throws a typed ExpressForgeError otherwise. */
  validateCredentials(options?: RequestOptions): Promise<void>;
  listModels?(options?: RequestOptions): Promise<ModelMetadata[]>;
  proposeProjectSpec(input: ProjectAnalysisInput, options?: RequestOptions): Promise<ProjectSpec>;
}

export interface ProviderContext {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
}

/** What a provider package registers: metadata plus a way to build the adapter. */
export interface ProviderDefinition {
  readonly metadata: ProviderMetadata;
  create(context: ProviderContext): AIProvider;
}
