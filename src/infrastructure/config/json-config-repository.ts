import fs from "node:fs/promises";
import path from "node:path";
import { migrateConfig, type AppConfig, type ConfigMigration } from "../../application/config.js";
import type { ConfigRepository } from "../../application/ports.js";
import { CONFIG_FILE_NAME } from "../../shared/constants.js";
import { ExpressForgeError } from "../../shared/errors.js";
import { readTextIfExists, toFilesystemError, writePrivateFile } from "../fs/secure-files.js";

/** Stores non-secret settings as versioned JSON in the user's config directory. */
export class JsonConfigRepository implements ConfigRepository {
  readonly location: string;

  constructor(
    private readonly directory: string,
    private readonly migrations: readonly ConfigMigration[] = []
  ) {
    this.location = path.join(directory, CONFIG_FILE_NAME);
  }

  async load(): Promise<AppConfig | undefined> {
    let text: string | undefined;
    try {
      text = await readTextIfExists(this.location);
    } catch (error) {
      throw toFilesystemError(error, "read the configuration file", this.location);
    }
    if (text === undefined) return undefined;

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ExpressForgeError("CONFIG_INVALID", "The configuration file is not valid JSON.", {
        hint: `Fix or delete ${this.location}, or run \`expressforge config remove\`.`
      });
    }
    return migrateConfig(raw, this.migrations);
  }

  async save(config: AppConfig): Promise<void> {
    try {
      await writePrivateFile(this.location, `${JSON.stringify(config, null, 2)}\n`);
    } catch (error) {
      throw toFilesystemError(error, "save the configuration file", this.location);
    }
  }

  async remove(): Promise<void> {
    try {
      await fs.rm(this.location, { force: true });
    } catch (error) {
      throw toFilesystemError(error, "remove the configuration file", this.location);
    }
  }
}
