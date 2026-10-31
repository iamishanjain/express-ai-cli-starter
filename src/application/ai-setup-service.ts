import { VALIDATION_TIMEOUT_MS } from "../shared/constants.js";
import { ExpressForgeError, isExpressForgeError } from "../shared/errors.js";
import { registerSecret } from "../shared/redact.js";
import type { CredentialBackend } from "./config.js";
import type { ConfigService } from "./config-service.js";
import type { CredentialService } from "./credential-service.js";
import type { ProviderFactory } from "./provider-factory.js";
import type { ProviderRegistry } from "./provider-registry.js";

export interface PersistRequest {
  readonly providerId: string;
  readonly apiKey: string;
  readonly model?: string;
  /** Overrides the configured backend, for example after the user accepts the file fallback. */
  readonly backend?: CredentialBackend;
}

/** First-run and `config set` use cases: verify a key, store it, record the settings. */
export class AiSetupService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly factory: ProviderFactory,
    private readonly credentials: CredentialService,
    private readonly config: ConfigService
  ) {}

  /** Makes a minimal provider request to confirm the key works. Nothing is stored. */
  async verify(providerId: string, apiKey: string, model?: string, signal?: AbortSignal): Promise<void> {
    registerSecret(apiKey);
    const provider = await this.factory.create(providerId, { apiKey, model, timeoutMs: VALIDATION_TIMEOUT_MS });
    await provider.validateCredentials(signal ? { signal } : undefined);
  }

  /** Stores a verified key and enables AI. Returns the backend that holds the key. */
  async persist(request: PersistRequest): Promise<CredentialBackend> {
    const backend = await this.credentials.save(request.providerId, request.apiKey, request.backend);
    await this.config.update({ aiEnabled: true, defaultProvider: request.providerId, credentialBackend: backend });
    if (request.model) await this.config.setProviderModel(request.providerId, request.model);
    return backend;
  }

  /** Records that the user chose not to use AI so the first-run question is not asked again. */
  async decline(): Promise<void> {
    await this.config.update({ aiEnabled: false });
  }

  /**
   * Checks a model id against the provider's model list. Fails open: if the list
   * cannot be fetched the model is accepted and `checked` is false.
   */
  async checkModel(
    providerId: string,
    model: string,
    options: { signal?: AbortSignal; apiKey?: string } = {}
  ): Promise<{ checked: boolean }> {
    const { signal, apiKey } = options;
    const provider = await this.factory.create(providerId, { model, apiKey, timeoutMs: VALIDATION_TIMEOUT_MS });
    if (!provider.listModels) return { checked: false };
    let models;
    try {
      models = await provider.listModels(signal ? { signal } : undefined);
    } catch (error) {
      if (isExpressForgeError(error) && error.code === "INVALID_API_KEY") throw error;
      return { checked: false };
    }
    if (!models.some((candidate) => candidate.id === model)) {
      throw new ExpressForgeError(
        "UNSUPPORTED_MODEL",
        `Model "${model}" is not available for ${provider.metadata.displayName}.`,
        {
          hint: "Use `expressforge config set --model <id>` with a model your key can access."
        }
      );
    }
    return { checked: true };
  }

  /** Removes stored credentials for every provider and deletes the configuration. */
  async removeAll(): Promise<ExpressForgeError[]> {
    const problems: ExpressForgeError[] = [];
    for (const definition of this.registry.list()) {
      problems.push(...(await this.credentials.remove(definition.metadata.id)));
    }
    await this.config.clear();
    return problems;
  }
}
