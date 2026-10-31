import type { AIProvider } from "../domain/ai-provider.js";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../shared/constants.js";
import { registerSecret } from "../shared/redact.js";
import type { CredentialService } from "./credential-service.js";
import type { ProviderRegistry } from "./provider-registry.js";

export interface CreateProviderOptions {
  readonly model?: string;
  /** Use this key instead of looking one up, for example while verifying a new key. */
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}

/** Resolves a provider id to a ready-to-use adapter. The only place that joins registry and credentials. */
export class ProviderFactory {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly credentials: CredentialService
  ) {}

  async create(providerId: string, options: CreateProviderOptions = {}): Promise<AIProvider> {
    const definition = this.registry.get(providerId);
    let apiKey = options.apiKey;
    if (apiKey === undefined) apiKey = (await this.credentials.resolve(providerId)).apiKey;
    registerSecret(apiKey);
    return definition.create({
      apiKey,
      model: options.model ?? definition.metadata.defaultModel,
      timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    });
  }
}
