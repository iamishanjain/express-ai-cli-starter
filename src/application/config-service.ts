import { defaultConfig, type AppConfig } from "./config.js";
import type { ConfigRepository } from "./ports.js";

/** Reads and updates persisted (non-secret) settings. */
export class ConfigService {
  constructor(private readonly repository: ConfigRepository) {}

  get location(): string {
    return this.repository.location;
  }

  async exists(): Promise<boolean> {
    return (await this.repository.load()) !== undefined;
  }

  async get(): Promise<AppConfig> {
    return (await this.repository.load()) ?? defaultConfig();
  }

  async update(patch: Partial<Omit<AppConfig, "configVersion" | "providers">>): Promise<AppConfig> {
    const next: AppConfig = { ...(await this.get()), ...patch };
    await this.repository.save(next);
    return next;
  }

  async setProviderModel(providerId: string, model: string): Promise<AppConfig> {
    const current = await this.get();
    const next: AppConfig = {
      ...current,
      providers: { ...current.providers, [providerId]: { ...current.providers[providerId], model } }
    };
    await this.repository.save(next);
    return next;
  }

  async clear(): Promise<void> {
    await this.repository.remove();
  }
}
