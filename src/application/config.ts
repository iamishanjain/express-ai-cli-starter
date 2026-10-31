import { z } from "zod";
import { CURRENT_CONFIG_VERSION } from "../shared/constants.js";
import { ExpressForgeError } from "../shared/errors.js";

export const CREDENTIAL_BACKENDS = ["keyring", "file"] as const;
export type CredentialBackend = (typeof CREDENTIAL_BACKENDS)[number];

/** Persisted settings. Never contains secrets. */
export const AppConfigSchema = z.object({
  configVersion: z.number().int().positive(),
  /** undefined means the first-run question has not been answered yet. */
  aiEnabled: z.boolean().optional(),
  defaultProvider: z.string().min(1).optional(),
  credentialBackend: z.enum(CREDENTIAL_BACKENDS).default("keyring"),
  providers: z.record(z.string(), z.object({ model: z.string().min(1).optional() })).default({})
});

export type AppConfig = z.output<typeof AppConfigSchema>;

export function defaultConfig(): AppConfig {
  return { configVersion: CURRENT_CONFIG_VERSION, credentialBackend: "keyring", providers: {} };
}

export interface ConfigMigration {
  /** Config version this step upgrades from; it produces `from + 1`. */
  readonly from: number;
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

/** Upgrades older config files step by step and validates the result. */
export function migrateConfig(
  raw: unknown,
  migrations: readonly ConfigMigration[] = [],
  targetVersion: number = CURRENT_CONFIG_VERSION
): AppConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalid("The configuration file is not a JSON object.");
  }
  let current = raw as Record<string, unknown>;
  let version = current.configVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw invalid("The configuration file has no valid configVersion.");
  }
  if (version > targetVersion) {
    throw new ExpressForgeError(
      "CONFIG_INVALID",
      `The configuration was written by a newer ExpressForge (config version ${version}).`,
      { hint: "Upgrade ExpressForge, or run `expressforge config remove` to start over." }
    );
  }
  while (version < targetVersion) {
    const step = migrations.find((migration) => migration.from === version);
    if (!step) throw invalid(`No migration is available from config version ${version}.`);
    current = { ...step.migrate(current), configVersion: version + 1 };
    version += 1;
  }
  const parsed = AppConfigSchema.safeParse(current);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join(".") || "(root)";
    throw invalid(`The configuration file is invalid at "${where}".`);
  }
  return parsed.data;
}

function invalid(message: string): ExpressForgeError {
  return new ExpressForgeError("CONFIG_INVALID", message, {
    hint: "Fix or delete the configuration file, or run `expressforge config remove`."
  });
}
