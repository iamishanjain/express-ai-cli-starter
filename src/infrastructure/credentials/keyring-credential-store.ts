import type { CredentialStore } from "../../application/ports.js";
import { KEYRING_SERVICE } from "../../shared/constants.js";
import { ExpressForgeError } from "../../shared/errors.js";

export interface KeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

export type KeyringEntryFactory = (service: string, account: string) => Promise<KeyringEntry>;

/** Loads the native module lazily so a missing binary degrades into a typed error. */
const nativeEntryFactory: KeyringEntryFactory = async (service, account) => {
  const { AsyncEntry } = await import("@napi-rs/keyring");
  return new AsyncEntry(service, account);
};

/** OS credential store: macOS Keychain, Windows Credential Manager, Linux Secret Service. */
export class KeyringCredentialStore implements CredentialStore {
  readonly backend = "keyring" as const;

  constructor(private readonly entryFactory: KeyringEntryFactory = nativeEntryFactory) {}

  async get(providerId: string): Promise<string | undefined> {
    return this.run(async () => (await this.entry(providerId)).getPassword()).then((value) => value ?? undefined);
  }

  async set(providerId: string, secret: string): Promise<void> {
    await this.run(async () => (await this.entry(providerId)).setPassword(secret));
  }

  async delete(providerId: string): Promise<void> {
    await this.run(async () => (await this.entry(providerId)).deletePassword());
  }

  private entry(providerId: string): Promise<KeyringEntry> {
    return this.entryFactory(KEYRING_SERVICE, providerId);
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw unavailable(error);
    }
  }
}

function unavailable(cause: unknown): ExpressForgeError {
  return new ExpressForgeError(
    "CREDENTIAL_STORE_UNAVAILABLE",
    "The operating system credential store is not available.",
    {
      hint:
        "Set the provider's API key environment variable (for example GEMINI_API_KEY), " +
        "or opt in to the file fallback with `expressforge config set --insecure-file-storage`.",
      cause
    }
  );
}
