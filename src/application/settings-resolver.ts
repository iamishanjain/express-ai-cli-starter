import { DEFAULT_PROVIDER_ID, MODEL_ENV, PROVIDER_ENV } from "../shared/constants.js";
import type { ConfigService } from "./config-service.js";
import type { Environment } from "./credential-service.js";
import type { ProviderRegistry } from "./provider-registry.js";

export interface SettingsFlags {
  readonly provider?: string;
  readonly model?: string;
}

export interface ResolvedSettings {
  readonly providerId: string;
  readonly model: string;
  /** undefined until the user has answered the first-run question. */
  readonly aiEnabled: boolean | undefined;
}

/**
 * Deterministic precedence, highest first:
 *   1. CLI flags
 *   2. Environment (EXPRESSFORGE_PROVIDER / EXPRESSFORGE_MODEL, then the provider's own model variable)
 *   3. Stored configuration
 *   4. Built-in defaults
 */
export class SettingsResolver {
  constructor(
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistry,
    private readonly env: Environment
  ) {}

  async resolve(flags: SettingsFlags = {}): Promise<ResolvedSettings> {
    const stored = await this.config.get();
    const providerId =
      flags.provider ?? nonEmpty(this.env[PROVIDER_ENV]) ?? stored.defaultProvider ?? DEFAULT_PROVIDER_ID;
    const { metadata } = this.registry.get(providerId);
    const model =
      flags.model ??
      nonEmpty(this.env[MODEL_ENV]) ??
      (metadata.modelEnvVar ? nonEmpty(this.env[metadata.modelEnvVar]) : undefined) ??
      stored.providers[providerId]?.model ??
      metadata.defaultModel;
    return { providerId, model, aiEnabled: stored.aiEnabled };
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
