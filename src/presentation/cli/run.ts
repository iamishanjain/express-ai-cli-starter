import { CommanderError } from "commander";
import { EXIT_CODES, isExpressForgeError } from "../../shared/errors.js";
import type { CliContext } from "../context.js";
import { formatError } from "../ui/format-error.js";
import { createProgram } from "./program.js";

/** Parses `args` (without node and script), runs the command, and returns the process exit code. */
export async function runCli(args: string[], ctx: CliContext): Promise<number> {
  let exitCode: number = EXIT_CODES.OK;

  const report = (error: unknown): void => {
    if (isExpressForgeError(error) && error.code === "CANCELLED") {
      ctx.ui.warn(error.message === "Cancelled." ? "Cancelled. No files were written." : error.message);
      exitCode = EXIT_CODES.CANCELLED;
      return;
    }
    const formatted = formatError(error, ctx.debug);
    for (const line of formatted.lines) ctx.ui.error(line);
    exitCode = formatted.exitCode;
  };

  try {
    await createProgram(ctx, report).parseAsync(args, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help and version exit with 0; any other Commander error is a usage mistake.
      exitCode = error.exitCode === 0 ? EXIT_CODES.OK : EXIT_CODES.USAGE;
    } else {
      report(error);
    }
  }
  return ctx.signal.aborted && exitCode === EXIT_CODES.OK ? EXIT_CODES.CANCELLED : exitCode;
}
