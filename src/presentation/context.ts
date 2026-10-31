import type { AiSetupService } from "../application/ai-setup-service.js";
import type { ConfigService } from "../application/config-service.js";
import type { CredentialService, Environment } from "../application/credential-service.js";
import type { PackageInstaller, ProjectGenerator, TemplateCatalog } from "../application/ports.js";
import type { ProviderFactory } from "../application/provider-factory.js";
import type { ProviderRegistry } from "../application/provider-registry.js";
import type { SettingsResolver } from "../application/settings-resolver.js";
import type { Logger } from "../shared/logger.js";
import type { Prompter } from "./prompts/prompter.js";
import type { Ui } from "./ui/ui.js";

/** Everything the commands need, assembled once by the composition root. */
export interface CliContext {
  readonly ui: Ui;
  readonly prompter: Prompter;
  readonly logger: Logger;
  readonly env: Environment;
  readonly cwd: string;
  /** Source for `config set --stdin`. */
  readonly stdin: NodeJS.ReadableStream;
  /** True when stdin and stdout are terminals, so prompts can be shown. */
  readonly isInteractive: boolean;
  /** Aborted when the user presses Ctrl+C. */
  readonly signal: AbortSignal;
  readonly debug: boolean;
  readonly version: string;
  /** Where the plaintext credentials file would live if the user opts into the fallback. */
  readonly fileStoreLocation: string;

  readonly registry: ProviderRegistry;
  readonly config: ConfigService;
  readonly credentials: CredentialService;
  readonly settings: SettingsResolver;
  readonly factory: ProviderFactory;
  readonly setup: AiSetupService;
  readonly generator: ProjectGenerator;
  readonly catalog: TemplateCatalog;
  readonly installer: PackageInstaller;
}
