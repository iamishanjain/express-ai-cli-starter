import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AiSetupService } from "./application/ai-setup-service.js";
import { ConfigService } from "./application/config-service.js";
import { CredentialService, type Environment } from "./application/credential-service.js";
import type { ConfigRepository, CredentialStore, PackageInstaller } from "./application/ports.js";
import { ProviderFactory } from "./application/provider-factory.js";
import { ProviderRegistry } from "./application/provider-registry.js";
import { SettingsResolver } from "./application/settings-resolver.js";
import type { ProviderDefinition } from "./domain/ai-provider.js";
import { JsonConfigRepository } from "./infrastructure/config/json-config-repository.js";
import { getConfigDir } from "./infrastructure/config/config-paths.js";
import { FileCredentialStore } from "./infrastructure/credentials/file-credential-store.js";
import { KeyringCredentialStore } from "./infrastructure/credentials/keyring-credential-store.js";
import { geminiDefinition } from "./infrastructure/providers/gemini/gemini-provider.js";
import { NpmInstaller } from "./infrastructure/system/npm-installer.js";
import { FileSystemTemplateSource } from "./infrastructure/templates/template-source.js";
import { TemplateProjectGenerator } from "./infrastructure/templates/template-project-generator.js";
import type { CliContext } from "./presentation/context.js";
import { InquirerPrompter, type Prompter } from "./presentation/prompts/prompter.js";
import { TerminalUi, type Ui } from "./presentation/ui/ui.js";
import { createLogger } from "./shared/logger.js";

export interface BuildOptions {
  env: Environment;
  cwd: string;
  stdin?: NodeJS.ReadableStream;
  isInteractive: boolean;
  signal: AbortSignal;
  debug: boolean;
  /** Overrides below exist so tests can run the real wiring against fakes. */
  configDir?: string;
  providers?: ProviderDefinition[];
  credentialStores?: { keyring?: CredentialStore };
  configRepository?: ConfigRepository;
  installer?: PackageInstaller;
  prompter?: Prompter;
  ui?: Ui;
  templatesRoot?: string;
}

/** The single place where concrete implementations are chosen and connected. */
export function buildContext(options: BuildOptions): CliContext {
  const configDir = options.configDir ?? getConfigDir();
  const fileStore = new FileCredentialStore(configDir);

  const registry = new ProviderRegistry();
  for (const provider of options.providers ?? [geminiDefinition]) registry.register(provider);

  const config = new ConfigService(options.configRepository ?? new JsonConfigRepository(configDir));
  const credentials = new CredentialService(
    [options.credentialStores?.keyring ?? new KeyringCredentialStore(), fileStore],
    config,
    registry,
    options.env
  );
  const factory = new ProviderFactory(registry, credentials);
  const templates = new TemplateProjectGenerator(
    new FileSystemTemplateSource(options.templatesRoot ?? fileURLToPath(new URL("../templates", import.meta.url)))
  );

  return {
    ui: options.ui ?? new TerminalUi(),
    prompter: options.prompter ?? new InquirerPrompter(),
    logger: createLogger({ debug: options.debug }),
    env: options.env,
    cwd: options.cwd,
    stdin: options.stdin ?? process.stdin,
    isInteractive: options.isInteractive,
    signal: options.signal,
    debug: options.debug,
    version: readVersion(),
    fileStoreLocation: fileStore.location,
    registry,
    config,
    credentials,
    settings: new SettingsResolver(config, registry, options.env),
    factory,
    setup: new AiSetupService(registry, factory, credentials, config),
    generator: templates,
    catalog: templates,
    installer: options.installer ?? new NpmInstaller()
  };
}

function readVersion(): string {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return packageJson.version;
}
