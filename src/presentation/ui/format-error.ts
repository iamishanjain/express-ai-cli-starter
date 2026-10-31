import { toExpressForgeError, type ExpressForgeError } from "../../shared/errors.js";
import { redact } from "../../shared/redact.js";

export interface FormattedError {
  readonly exitCode: number;
  readonly lines: string[];
}

/** Turns any thrown value into consistent, secret-free terminal output. */
export function formatError(error: unknown, debug: boolean): FormattedError {
  const typed: ExpressForgeError = toExpressForgeError(error);
  const lines = [`✖ ${typed.message} (${typed.code})`];
  if (typed.hint) lines.push(`  ${typed.hint}`);

  if (debug) {
    const details = Object.entries(typed.details ?? {}).filter(([, value]) => value !== undefined);
    for (const [key, value] of details) lines.push(`  ${key}: ${String(value)}`);
    if (typed.stack) lines.push(redact(typed.stack).split("\n").slice(1, 8).join("\n"));
    if (typed.cause instanceof Error) lines.push(`  cause: ${redact(`${typed.cause.name}: ${typed.cause.message}`)}`);
  }
  return { exitCode: typed.exitCode, lines: lines.map(redact) };
}
