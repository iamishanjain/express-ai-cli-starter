import path from "node:path";
import { z } from "zod";
import type { CredentialStore } from "../../application/ports.js";
import { CREDENTIALS_FILE_NAME } from "../../shared/constants.js";
import { ExpressForgeError } from "../../shared/errors.js";
import { readTextIfExists, toFilesystemError, writePrivateFile } from "../fs/secure-files.js";

const CredentialFileSchema = z.record(z.string(), z.string());

/**
 * Plaintext fallback for systems without an OS credential store.
 * Only used after explicit user consent. The file is created with mode 0600 in a
 * 0700 directory; on Windows those modes are not enforced by the OS.
 */
export class FileCredentialStore implements CredentialStore {
  readonly backend = "file" as const;
  readonly location: string;

  constructor(directory: string) {
    this.location = path.join(directory, CREDENTIALS_FILE_NAME);
  }

  async get(providerId: string): Promise<string | undefined> {
    return (await this.read())[providerId];
  }

  async set(providerId: string, secret: string): Promise<void> {
    const entries = await this.read();
    entries[providerId] = secret;
    await this.write(entries);
  }

  async delete(providerId: string): Promise<void> {
    const entries = await this.read();
    if (!(providerId in entries)) return;
    delete entries[providerId];
    await this.write(entries);
  }

  private async read(): Promise<Record<string, string>> {
    let text: string | undefined;
    try {
      text = await readTextIfExists(this.location);
    } catch (error) {
      throw toFilesystemError(error, "read the credentials file", this.location);
    }
    if (text === undefined) return {};
    try {
      return CredentialFileSchema.parse(JSON.parse(text));
    } catch {
      throw new ExpressForgeError("CREDENTIAL_STORE_UNAVAILABLE", "The credentials file is corrupted.", {
        hint: `Delete ${this.location} and run \`expressforge config set\` again.`
      });
    }
  }

  private async write(entries: Record<string, string>): Promise<void> {
    try {
      await writePrivateFile(this.location, `${JSON.stringify(entries, null, 2)}\n`);
    } catch (error) {
      throw toFilesystemError(error, "write the credentials file", this.location);
    }
  }
}
