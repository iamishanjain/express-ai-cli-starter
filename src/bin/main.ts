#!/usr/bin/env node
import { buildContext } from "../composition.js";
import { runCli } from "../presentation/cli/run.js";
import { formatError } from "../presentation/ui/format-error.js";
import { EXIT_CODES } from "../shared/errors.js";

const controller = new AbortController();
process.on("SIGINT", () => {
  // First Ctrl+C asks running work to stop cleanly; a second one exits immediately.
  if (controller.signal.aborted) process.exit(EXIT_CODES.CANCELLED);
  controller.abort();
});

const args = process.argv.slice(2);
const debug = args.includes("--debug") || process.env.EXPRESSFORGE_DEBUG === "1";

try {
  const ctx = buildContext({
    env: process.env,
    cwd: process.cwd(),
    isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && process.env.CI === undefined,
    signal: controller.signal,
    debug
  });
  process.exitCode = await runCli(args, ctx);
} catch (error) {
  const formatted = formatError(error, debug);
  for (const line of formatted.lines) process.stderr.write(`${line}\n`);
  process.exitCode = formatted.exitCode;
}
