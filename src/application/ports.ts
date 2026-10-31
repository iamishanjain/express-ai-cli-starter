import type { ProjectSpec } from "../domain/project-spec.js";
import type { AppConfig, CredentialBackend } from "./config.js";

/** Secret storage for one backend. Implementations must never log or echo values. */
export interface CredentialStore {
  readonly backend: CredentialBackend;
  get(providerId: string): Promise<string | undefined>;
  set(providerId: string, secret: string): Promise<void>;
  delete(providerId: string): Promise<void>;
}

export interface ConfigRepository {
  /** Human-readable location, safe to print. */
  readonly location: string;
  /** Returns undefined when no configuration exists yet. */
  load(): Promise<AppConfig | undefined>;
  save(config: AppConfig): Promise<void>;
  remove(): Promise<void>;
}

export interface ProjectOptions {
  readonly projectName: string;
  readonly language: string;
  readonly database: string;
}

export interface GenerateProjectRequest {
  readonly options: ProjectOptions;
  /** Absolute path of the directory to create. */
  readonly projectPath: string;
  readonly spec?: ProjectSpec;
}

export interface GeneratedProject {
  readonly projectPath: string;
  readonly files: readonly string[];
}

export interface ProjectGenerator {
  /** Throws PROJECT_EXISTS when something already lives at `projectPath`. */
  assertAvailable(projectPath: string): Promise<void>;
  /** Creates `projectPath` and writes the project. Cleans up after itself on failure. */
  generate(request: GenerateProjectRequest): Promise<GeneratedProject>;
}

export interface TemplateChoice {
  readonly value: string;
  readonly label: string;
  readonly isDefault: boolean;
}

export interface TemplateCatalog {
  /** Choices for a template category such as "language" or "database", in display order. */
  choices(category: string): Promise<TemplateChoice[]>;
}

export interface PackageInstaller {
  install(cwd: string, signal?: AbortSignal): Promise<void>;
}
