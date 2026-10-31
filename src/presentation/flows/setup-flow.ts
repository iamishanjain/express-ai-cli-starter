import type { CredentialBackend } from "../../application/config.js";
import { isExpressForgeError, type ErrorCode } from "../../shared/errors.js";
import type { CliContext } from "../context.js";
import { formatError } from "../ui/format-error.js";

const RETRYABLE: readonly ErrorCode[] = ["INVALID_API_KEY", "NETWORK_TIMEOUT", "PROVIDER_UNAVAILABLE", "RATE_LIMITED"];
const MIN_KEY_LENGTH = 8;

export interface ConfigureOptions {
  providerId?: string;
  model?: string;
  /** Skip the keychain and use the plaintext file store (explicit opt-in). */
  insecureFileStorage?: boolean;
}

export function validateApiKeyInput(value: string): true | string {
  const key = value.trim();
  if (key.length < MIN_KEY_LENGTH) return `The key looks too short (at least ${MIN_KEY_LENGTH} characters).`;
  if (/\s/.test(key)) return "API keys cannot contain spaces.";
  return true;
}

/** The first-run question. Returns true when AI ends up configured. */
export async function runFirstRunSetup(ctx: CliContext): Promise<boolean> {
  ctx.ui.heading("First-time setup");
  ctx.ui.info("ExpressForge can use an AI provider to propose a database schema for your project.");
  const enable = await ctx.prompter.confirm({ message: "Enable AI-powered project analysis?", default: true });
  if (!enable) {
    await ctx.setup.decline();
    ctx.ui.info("Continuing without AI. Run `expressforge config set` any time to enable it.\n");
    return false;
  }
  return configureProvider(ctx, {});
}

/**
 * Interactive provider setup: choose a provider, enter a masked key, verify it
 * with a minimal API request, retry on failure, then store it securely.
 * Returns false when the user gives up or declines to store the key.
 */
export async function configureProvider(ctx: CliContext, options: ConfigureOptions): Promise<boolean> {
  const definitions = ctx.registry.list();
  const providerId =
    options.providerId ??
    (definitions.length === 1
      ? (definitions[0]?.metadata.id as string)
      : await ctx.prompter.select({
          message: "Choose an AI provider:",
          choices: definitions.map((definition) => ({
            name: definition.metadata.displayName,
            value: definition.metadata.id
          }))
        }));
  const { metadata } = ctx.registry.get(providerId);

  ctx.ui.info(`Provider: ${metadata.displayName}`);
  ctx.ui.info(`${metadata.credentialHint}\n`);

  for (;;) {
    const apiKey = (
      await ctx.prompter.password({ message: `${metadata.displayName} API key:`, validate: validateApiKeyInput })
    ).trim();

    const spinner = ctx.ui.spinner("Verifying API key...");
    try {
      await ctx.setup.verify(providerId, apiKey, options.model, ctx.signal);
      spinner.succeed("API key verified.");
      if (options.model) await ctx.setup.checkModel(providerId, options.model, { signal: ctx.signal, apiKey });
    } catch (error) {
      spinner.fail("Could not verify the API key.");
      if (!isExpressForgeError(error) || !RETRYABLE.includes(error.code)) throw error;
      for (const line of formatError(error, ctx.debug).lines) ctx.ui.error(line);
      const retry = await ctx.prompter.confirm({ message: "Try again?", default: true });
      if (!retry) return false;
      continue;
    }

    const backend = await storeKey(
      ctx,
      { providerId, apiKey, model: options.model },
      options.insecureFileStorage === true
    );
    if (!backend) return false;
    ctx.ui.success(`API key saved (${describeBackend(backend)}).`);
    return true;
  }
}

/** Stores a verified key. Returns the backend used, or undefined when the user declined the fallback. */
export async function storeKey(
  ctx: CliContext,
  request: { providerId: string; apiKey: string; model?: string },
  insecureFileStorage: boolean
): Promise<CredentialBackend | undefined> {
  if (insecureFileStorage) {
    warnAboutFileStorage(ctx);
    return ctx.setup.persist({ ...request, backend: "file" });
  }
  try {
    return await ctx.setup.persist(request);
  } catch (error) {
    if (!isExpressForgeError(error) || error.code !== "CREDENTIAL_STORE_UNAVAILABLE" || !ctx.isInteractive) throw error;
    ctx.ui.warn("The operating system credential store is not available on this machine.");
    ctx.ui.info(
      "The alternative is a plaintext file in your user config directory. It is readable only by your user account,"
    );
    ctx.ui.info(`but it is NOT encrypted: ${ctx.fileStoreLocation}`);
    const consent = await ctx.prompter.confirm({ message: "Store the API key in that file instead?", default: false });
    if (!consent) {
      ctx.ui.info("The key was not saved. You can set the provider's API key environment variable instead.");
      return undefined;
    }
    warnAboutFileStorage(ctx);
    return ctx.setup.persist({ ...request, backend: "file" });
  }
}

export function describeBackend(backend: CredentialBackend): string {
  return backend === "keyring" ? "in the OS credential store" : "in a plaintext file";
}

function warnAboutFileStorage(ctx: CliContext): void {
  ctx.ui.warn(`Security: the API key will be stored unencrypted in ${ctx.fileStoreLocation} (permissions 0600).`);
}
