import { ExpressForgeError, isExpressForgeError } from "../shared/errors.js";
import { registerSecret } from "../shared/redact.js";
import type { CredentialBackend } from "./config.js";
import type { ConfigService } from "./config-service.js";
import type { CredentialStore } from "./ports.js";
import type { ProviderRegistry } from "./provider-registry.js";

export type CredentialSource = "env" | CredentialBackend;

export interface ResolvedCredential {
  readonly apiKey: string;
  readonly source: CredentialSource;
}

export interface CredentialInspection {
  readonly source: CredentialSource | "none";
  /** Set when the configured backend could not be read. */
  readonly problem?: ExpressForgeError;
}

export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Finds a provider's API key. Precedence: environment variable, then the
 * credential backend recorded in the configuration. It never falls back to a
 * different backend on its own.
 */
export class CredentialService {
  private readonly stores = new Map<CredentialBackend, CredentialStore>();

  constructor(
    stores: readonly CredentialStore[],
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistry,
    private readonly env: Environment
  ) {
    for (const store of stores) this.stores.set(store.backend, store);
  }

  async inspect(providerId: string): Promise<CredentialInspection> {
    try {
      const found = await this.find(providerId);
      return { source: found?.source ?? "none" };
    } catch (error) {
      if (isExpressForgeError(error)) return { source: "none", problem: error };
      throw error;
    }
  }

  async resolve(providerId: string): Promise<ResolvedCredential> {
    const found = await this.find(providerId);
    if (!found) {
      const { displayName, envVar } = this.registry.get(providerId).metadata;
      throw new ExpressForgeError("MISSING_API_KEY", `No ${displayName} API key is configured.`, {
        hint: `Run \`expressforge config set\`, or set ${envVar} in your environment.`
      });
    }
    return found;
  }

  /** Stores a key and returns the backend that was used. */
  async save(providerId: string, apiKey: string, backend?: CredentialBackend): Promise<CredentialBackend> {
    registerSecret(apiKey);
    const target = backend ?? (await this.config.get()).credentialBackend;
    await this.store(target).set(providerId, apiKey);
    return target;
  }

  /** Deletes stored keys from every backend. Returns problems for backends that could not be reached. */
  async remove(providerId: string): Promise<ExpressForgeError[]> {
    const problems: ExpressForgeError[] = [];
    for (const store of this.stores.values()) {
      try {
        await store.delete(providerId);
      } catch (error) {
        if (!isExpressForgeError(error)) throw error;
        problems.push(error);
      }
    }
    return problems;
  }

  private async find(providerId: string): Promise<ResolvedCredential | undefined> {
    const { envVar } = this.registry.get(providerId).metadata;
    const fromEnv = this.env[envVar]?.trim();
    if (fromEnv) {
      registerSecret(fromEnv);
      return { apiKey: fromEnv, source: "env" };
    }
    const backend = (await this.config.get()).credentialBackend;
    const stored = await this.store(backend).get(providerId);
    if (!stored) return undefined;
    registerSecret(stored);
    return { apiKey: stored, source: backend };
  }

  private store(backend: CredentialBackend): CredentialStore {
    const store = this.stores.get(backend);
    if (!store) {
      throw new ExpressForgeError("CREDENTIAL_STORE_UNAVAILABLE", `No credential store for backend "${backend}".`);
    }
    return store;
  }
}
