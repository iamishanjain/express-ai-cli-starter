import { Command } from "commander";
import { LEGACY_BIN_NAME } from "../../shared/constants.js";
import { getConfigValue, removeConfig, setConfig, showConfig, validateConfig } from "../commands/config-commands.js";
import { listProviders } from "../commands/providers-commands.js";
import type { CliContext } from "../context.js";
import { runCreate, type CreateFlags } from "../flows/create-flow.js";

/** Builds the command tree. Errors from handlers are passed to `onError`. */
export function createProgram(ctx: CliContext, onError: (error: unknown) => void): Command {
  const program = new Command();
  program
    .name("expressforge")
    .description("Generate an Express API starter, optionally using AI to propose your data model.")
    .version(ctx.version, "-V, --version", "print the version")
    .option("--debug", "print technical details when something fails (secrets are still redacted)")
    .configureOutput({
      writeOut: (text) => ctx.ui.write(text),
      writeErr: (text) => ctx.ui.writeError(text)
    })
    .exitOverride()
    .showHelpAfterError("(run with --help for usage)")
    .addHelpText(
      "after",
      `
Examples:
  $ expressforge                              interactive wizard (first run sets up AI)
  $ expressforge create --name api --language typescript --database postgresql --no-ai --yes
  $ expressforge config set                   add or replace your API key
  $ expressforge providers list

\`${LEGACY_BIN_NAME}\` is kept as an alias for \`expressforge\`.`
    );

  const handle =
    <A extends unknown[]>(action: (...args: A) => Promise<void>) =>
    async (...args: A): Promise<void> => {
      try {
        await action(...args);
      } catch (error) {
        onError(error);
      }
    };

  program
    .command("create", { isDefault: true })
    .description("create a new Express project (default command)")
    .option("-n, --name <name>", "project name (also the directory name)")
    .option("-d, --description <text>", "describe the project; used for AI analysis")
    .option("-l, --language <language>", "project language, for example typescript or javascript")
    .option("--database <database>", "database, for example postgresql, mysql, mongodb or none")
    .option("--provider <id>", "AI provider to use")
    .option("--model <id>", "AI model to use")
    .option("--ai", "use AI to propose the schema (needs a configured key)")
    .option("--no-ai", "do not use AI")
    .option("--approve-schema", "pre-approve the validated AI proposal when prompts are unavailable")
    .option("--install", "install dependencies after generating")
    .option("--no-install", "do not install dependencies")
    .option("-y, --yes", "accept defaults and never prompt")
    .action(handle(async (flags: CreateFlags) => runCreate(ctx, flags)));

  const config = program
    .command("config")
    .description("manage AI provider settings and API keys")
    .action(handle(async () => showConfig(ctx, {})));

  config
    .command("show")
    .description("show the current configuration (never prints API keys)")
    .option("--json", "machine-readable output")
    .action(handle(async (flags: { json?: boolean }) => showConfig(ctx, flags)));
  config
    .command("get <key>")
    .description("print one setting: provider, model, ai, backend or path")
    .action(handle(async (key: string) => getConfigValue(ctx, key)));
  config
    .command("set")
    .description("set up or replace the API key, or change the provider or model")
    .option("--provider <id>", "provider to configure")
    .option("--model <id>", "default model for the provider")
    .option("--stdin", "read the API key from standard input (for scripts)")
    .option("--insecure-file-storage", "store the key in a 0600 plaintext file instead of the OS credential store")
    .action(handle(async (flags: Parameters<typeof setConfig>[1]) => setConfig(ctx, flags)));
  config
    .command("remove")
    .description("delete the saved configuration and stored API keys")
    .option("-y, --yes", "do not ask for confirmation")
    .action(handle(async (flags: { yes?: boolean }) => removeConfig(ctx, flags)));
  config
    .command("validate")
    .description("check that the configured API key works")
    .option("--provider <id>", "provider to validate")
    .action(handle(async (flags: { provider?: string }) => validateConfig(ctx, flags)));

  const providers = program
    .command("providers")
    .description("list available AI providers")
    .action(handle(async () => listProviders(ctx, {})));
  providers
    .command("list")
    .description("list available AI providers")
    .option("--json", "machine-readable output")
    .action(handle(async (flags: { json?: boolean }) => listProviders(ctx, flags)));

  return program;
}
