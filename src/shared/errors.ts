import { redact } from "./redact.js";

export const ERROR_CODES = [
  "INTERNAL",
  "INVALID_INPUT",
  "NON_INTERACTIVE",
  "SCHEMA_VALIDATION_FAILED",
  "MISSING_API_KEY",
  "INVALID_API_KEY",
  "CREDENTIAL_STORE_UNAVAILABLE",
  "CONFIG_INVALID",
  "UNSUPPORTED_PROVIDER",
  "UNSUPPORTED_MODEL",
  "PROVIDER_UNAVAILABLE",
  "NETWORK_TIMEOUT",
  "RATE_LIMITED",
  "INVALID_AI_RESPONSE",
  "TEMPLATE_NOT_FOUND",
  "TEMPLATE_INVALID",
  "UNSAFE_PATH",
  "PROJECT_EXISTS",
  "FS_PERMISSION",
  "INSTALL_FAILED",
  "CANCELLED"
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const EXIT_CODES = {
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  CONFIG: 3,
  PROVIDER: 4,
  FILESYSTEM: 5,
  CANCELLED: 130
} as const;

const EXIT_CODE_BY_ERROR: Record<ErrorCode, number> = {
  INTERNAL: EXIT_CODES.INTERNAL,
  INVALID_INPUT: EXIT_CODES.USAGE,
  NON_INTERACTIVE: EXIT_CODES.USAGE,
  SCHEMA_VALIDATION_FAILED: EXIT_CODES.USAGE,
  MISSING_API_KEY: EXIT_CODES.CONFIG,
  INVALID_API_KEY: EXIT_CODES.CONFIG,
  CREDENTIAL_STORE_UNAVAILABLE: EXIT_CODES.CONFIG,
  CONFIG_INVALID: EXIT_CODES.CONFIG,
  UNSUPPORTED_PROVIDER: EXIT_CODES.CONFIG,
  UNSUPPORTED_MODEL: EXIT_CODES.CONFIG,
  PROVIDER_UNAVAILABLE: EXIT_CODES.PROVIDER,
  NETWORK_TIMEOUT: EXIT_CODES.PROVIDER,
  RATE_LIMITED: EXIT_CODES.PROVIDER,
  INVALID_AI_RESPONSE: EXIT_CODES.PROVIDER,
  TEMPLATE_NOT_FOUND: EXIT_CODES.FILESYSTEM,
  TEMPLATE_INVALID: EXIT_CODES.FILESYSTEM,
  UNSAFE_PATH: EXIT_CODES.FILESYSTEM,
  PROJECT_EXISTS: EXIT_CODES.FILESYSTEM,
  FS_PERMISSION: EXIT_CODES.FILESYSTEM,
  INSTALL_FAILED: EXIT_CODES.FILESYSTEM,
  CANCELLED: EXIT_CODES.CANCELLED
};

export interface ExpressForgeErrorOptions {
  /** Short recovery guidance shown to the user. */
  hint?: string;
  /** Non-sensitive technical context (status codes, ids, paths). */
  details?: Record<string, string | number | boolean | undefined>;
  cause?: unknown;
}

/**
 * Error with a stable code, a user-facing message, and safe details.
 * Messages are redacted on construction so a secret can never leak through them.
 */
export class ExpressForgeError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly details?: Record<string, string | number | boolean | undefined>;

  constructor(code: ErrorCode, message: string, options: ExpressForgeErrorOptions = {}) {
    super(redact(message), options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ExpressForgeError";
    this.code = code;
    if (options.hint !== undefined) this.hint = redact(options.hint);
    if (options.details !== undefined) this.details = options.details;
  }

  get exitCode(): number {
    return EXIT_CODE_BY_ERROR[this.code];
  }
}

export function isExpressForgeError(error: unknown): error is ExpressForgeError {
  return error instanceof ExpressForgeError;
}

/** Converts any thrown value into an ExpressForgeError without losing the safe parts. */
export function toExpressForgeError(error: unknown): ExpressForgeError {
  if (isExpressForgeError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ExpressForgeError("INTERNAL", `Unexpected error: ${message}`, {
    hint: "Re-run with --debug for more detail. If it persists, please open an issue.",
    cause: error
  });
}
