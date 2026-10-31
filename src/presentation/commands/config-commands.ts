import type { CredentialSource } from "../../application/credential-service.js";
import { ExpressForgeError, isExpressForgeError } from "../../shared/errors.js";
import type { CliContext } from "../context.js";
import { configureProvider, storeKey, validateApiKeyInput, describeBackend } from "../flows/setup-flow.js";

const GETTABLE_KEYS = ["provider", "model", "ai", "backend", "path"] as const;

export interface ConfigSetFlags {
  provider?: string;
  model?: string;
  stdin?: boolean;
  insecureFileStorage?: boolean;
}

interface ConfigStatus {
  configFile: string;
  aiEnabled: boolean | null;
  provider: string;
  model: string;
  credentialBackend: string;
  apiKey: CredentialSource | "none";
}

async function readStatus(ctx: CliContext): Promise<ConfigStatus> {
  const settings = await ctx.settings.resolve();
  const stored = await ctx.config.get();
  const inspection = await ctx.credentials.inspect(settings.providerId);
  return {
    configFile: ctx.config.location,
    aiEnabled: stored.aiEnabled ?? null,
    provider: settings.providerId,
    model: settings.model,
    credentialBackend: stored.credentialBackend,
    apiKey: inspection.source
  };
}

function describeKey(source: CredentialSource | "none", ctx: CliContext, providerId: string): string {
  switch (source) {
    case "env":
      return `provided by ${ctx.registry.get(providerId).metadata.envVar}`;
    case "keyring":
      return "stored in the OS credential store";
    case "file":
      return "stored in a plaintext file";
    case "none":
      return "not set";
  }
}

export async function showConfig(ctx: CliContext, flags: { json?: boolean }): Promise<void> {
  const status = await readStatus(ctx);
  if (flags.json) {
    ctx.ui.line(JSON.stringify(status, null, 2));
    return;
  }
  const ai = status.aiEnabled === null ? "not configured yet" : status.aiEnabled ? "enabled" : "disabled";
  ctx.ui.line(`Config file:        ${status.configFile}`);
  ctx.ui.line(`AI analysis:        ${ai}`);
  ctx.ui.line(`Provider:           ${status.provider}`);
  ctx.ui.line(`Model:              ${status.model}`);
  ctx.ui.line(`Credential backend: ${status.credentialBackend}`);
  ctx.ui.line(`API key:            ${describeKey(status.apiKey, ctx, status.provider)}`);
}

export async function getConfigValue(ctx: CliContext, key: string): Promise<void> {
  if (key === "api-key" || key === "apikey") {
    throw new ExpressForgeError("INVALID_INPUT", "API keys can never be read back.", {
      hint: "Use `expressforge config validate` to check that a key works."
    });
  }
  if (!(GETTABLE_KEYS as readonly string[]).includes(key)) {
    throw new ExpressForgeError("INVALID_INPUT", `Unknown config key "${key}".`, {
      hint: `Available keys: ${GETTABLE_KEYS.join(", ")}.`
    });
  }
  const status = await readStatus(ctx);
  const values: Record<(typeof GETTABLE_KEYS)[number], string> = {
    provider: status.provider,
    model: status.model,
    ai: status.aiEnabled === null ? "unset" : String(status.aiEnabled),
    backend: status.credentialBackend,
    path: status.configFile
  };
  ctx.ui.line(values[key as (typeof GETTABLE_KEYS)[number]]);
}

export async function setConfig(ctx: CliContext, flags: ConfigSetFlags): Promise<void> {
  if (flags.provider) ctx.registry.get(flags.provider);
  const settings = await ctx.settings.resolve({ provider: flags.provider });
  const providerId = flags.provider ?? settings.providerId;

  const needsKey = flags.stdin === true || (ctx.isInteractive && flags.model === undefined);

  if (!needsKey) {
    if (flags.model === undefined && flags.provider === undefined) {
      throw new ExpressForgeError("INVALID_INPUT", "Nothing to set.", {
        hint: "Pass --model, --provider, or --stdin (to read an API key from standard input)."
      });
    }
    await updateSettings(ctx, providerId, flags);
    return;
  }

  if (flags.stdin) {
    await setKeyFromStdin(ctx, providerId, flags);
    return;
  }

  const configured = await configureProvider(ctx, {
    providerId: flags.provider,
    model: flags.model,
    insecureFileStorage: flags.insecureFileStorage
  });
  if (!configured) ctx.ui.info("No changes were made.");
}

async function updateSettings(ctx: CliContext, providerId: string, flags: ConfigSetFlags): Promise<void> {
  if (flags.model !== undefined) {
    try {
      const { checked } = await ctx.setup.checkModel(providerId, flags.model, { signal: ctx.signal });
      if (!checked) ctx.ui.warn("Could not confirm the model with the provider; saving it anyway.");
    } catch (error) {
      if (!isExpressForgeError(error) || error.code !== "MISSING_API_KEY") throw error;
      ctx.ui.warn("No API key is configured yet, so the model could not be checked.");
    }
    await ctx.config.setProviderModel(providerId, flags.model);
  }
  if (flags.provider !== undefined) await ctx.config.update({ defaultProvider: providerId });
  ctx.ui.success("Configuration updated.");
}

async function setKeyFromStdin(ctx: CliContext, providerId: string, flags: ConfigSetFlags): Promise<void> {
  const apiKey = (await readAll(ctx.stdin)).trim();
  const problem = validateApiKeyInput(apiKey);
  if (problem !== true) throw new ExpressForgeError("INVALID_INPUT", `No usable API key on standard input. ${problem}`);

  const spinner = ctx.ui.spinner("Verifying API key...");
  try {
    await ctx.setup.verify(providerId, apiKey, flags.model, ctx.signal);
    spinner.succeed("API key verified.");
  } catch (error) {
    spinner.fail("Could not verify the API key.");
    throw error;
  }
  const backend = await storeKey(ctx, { providerId, apiKey, model: flags.model }, flags.insecureFileStorage === true);
  if (backend) ctx.ui.success(`API key saved (${describeBackend(backend)}).`);
}

export async function removeConfig(ctx: CliContext, flags: { yes?: boolean }): Promise<void> {
  if (!flags.yes) {
    if (!ctx.isInteractive) {
      throw new ExpressForgeError("NON_INTERACTIVE", "Confirmation is required to remove the configuration.", {
        hint: "Pass --yes to remove it without prompting."
      });
    }
    const confirmed = await ctx.prompter.confirm({
      message: "Remove the saved configuration and all stored API keys?",
      default: false
    });
    if (!confirmed) {
      ctx.ui.info("Nothing was removed.");
      return;
    }
  }
  const problems = await ctx.setup.removeAll();
  for (const problem of problems) ctx.ui.warn(`${problem.message} ${problem.hint ?? ""}`.trim());
  ctx.ui.success("Configuration and stored API keys removed.");
  ctx.ui.info("Environment variables (such as GEMINI_API_KEY) are not touched.");
}

export async function validateConfig(ctx: CliContext, flags: { provider?: string }): Promise<void> {
  const settings = await ctx.settings.resolve({ provider: flags.provider });
  const credential = await ctx.credentials.resolve(settings.providerId);
  const spinner = ctx.ui.spinner("Verifying API key...");
  try {
    await ctx.setup.verify(settings.providerId, credential.apiKey, settings.model, ctx.signal);
  } catch (error) {
    spinner.fail("The API key could not be verified.");
    throw error;
  }
  spinner.succeed(
    `API key for ${settings.providerId} is valid (${describeKey(credential.source, ctx, settings.providerId)}).`
  );
}

function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => (data += chunk));
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}
