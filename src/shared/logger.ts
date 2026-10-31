import { redact } from "./redact.js";

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerOptions {
  debug: boolean;
  write?: (line: string) => void;
}

/** Logs to stderr, keeps debug output opt-in, and redacts every line. */
export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const emit = (level: string, message: string): void => write(`[${level}] ${redact(message)}`);
  return {
    debug: (message) => {
      if (options.debug) emit("debug", message);
    },
    info: (message) => emit("info", message),
    warn: (message) => emit("warn", message),
    error: (message) => emit("error", message)
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};
