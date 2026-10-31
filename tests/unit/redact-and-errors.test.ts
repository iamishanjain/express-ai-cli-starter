import { afterEach, describe, expect, it } from "vitest";
import { ExpressForgeError, EXIT_CODES, ERROR_CODES, toExpressForgeError } from "../../src/shared/errors.js";
import { createLogger } from "../../src/shared/logger.js";
import { clearRegisteredSecrets, redact, registerSecret } from "../../src/shared/redact.js";
import { formatError } from "../../src/presentation/ui/format-error.js";

afterEach(() => clearRegisteredSecrets());

describe("redact", () => {
  it("masks registered secrets everywhere they appear", () => {
    registerSecret("super-secret-value");
    expect(redact("a super-secret-value b super-secret-value")).toBe("a [REDACTED] b [REDACTED]");
  });

  it("ignores very short values so ordinary words are not masked", () => {
    registerSecret("abc");
    expect(redact("abc")).toBe("abc");
  });

  it("masks Google API key shapes even when never registered", () => {
    expect(redact("failed with AIzaSyA1234567890abcdefghijklmnopqrstuv!")).not.toContain("AIzaSy");
  });

  it("masks bearer tokens and key query parameters", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop")).toBe("Authorization: [REDACTED]");
    expect(redact("https://x.test/v1?key=abc123456789&alt=json")).toBe("https://x.test/v1?key=[REDACTED]&alt=json");
  });
});

describe("ExpressForgeError", () => {
  it("redacts secrets from message and hint at construction", () => {
    registerSecret("my-registered-key");
    const error = new ExpressForgeError("INVALID_API_KEY", "bad my-registered-key", { hint: "try my-registered-key" });
    expect(error.message).not.toContain("my-registered-key");
    expect(error.hint).not.toContain("my-registered-key");
  });

  it("maps every error code to an exit code", () => {
    for (const code of ERROR_CODES) {
      expect(new ExpressForgeError(code, "x").exitCode).toBeGreaterThan(0);
    }
    expect(new ExpressForgeError("INVALID_API_KEY", "x").exitCode).toBe(EXIT_CODES.CONFIG);
    expect(new ExpressForgeError("RATE_LIMITED", "x").exitCode).toBe(EXIT_CODES.PROVIDER);
    expect(new ExpressForgeError("PROJECT_EXISTS", "x").exitCode).toBe(EXIT_CODES.FILESYSTEM);
    expect(new ExpressForgeError("CANCELLED", "x").exitCode).toBe(EXIT_CODES.CANCELLED);
  });

  it("wraps unknown errors as INTERNAL without losing the original", () => {
    const original = new Error("boom");
    const wrapped = toExpressForgeError(original);
    expect(wrapped.code).toBe("INTERNAL");
    expect(wrapped.cause).toBe(original);
    expect(toExpressForgeError("text").message).toContain("text");
  });
});

describe("formatError", () => {
  it("prints message, code and hint", () => {
    const { lines, exitCode } = formatError(
      new ExpressForgeError("MISSING_API_KEY", "No key.", { hint: "Run config set." }),
      false
    );
    expect(lines).toEqual(["✖ No key. (MISSING_API_KEY)", "  Run config set."]);
    expect(exitCode).toBe(EXIT_CODES.CONFIG);
  });

  it("never leaks a secret through stack, cause or details in debug mode", () => {
    registerSecret("leaky-secret-123");
    const cause = new Error("upstream said leaky-secret-123");
    const error = new ExpressForgeError("PROVIDER_UNAVAILABLE", "down", { cause, details: { status: 500 } });
    const text = formatError(error, true).lines.join("\n");
    expect(text).not.toContain("leaky-secret-123");
    expect(text).toContain("status: 500");
  });

  it("hides technical details unless debug is on", () => {
    const error = new ExpressForgeError("PROVIDER_UNAVAILABLE", "down", { details: { status: 500 } });
    expect(formatError(error, false).lines.join("\n")).not.toContain("status");
  });
});

describe("logger", () => {
  it("redacts and keeps debug opt-in", () => {
    registerSecret("logger-secret-value");
    const lines: string[] = [];
    const quiet = createLogger({ debug: false, write: (line) => lines.push(line) });
    quiet.debug("hidden");
    quiet.info("token logger-secret-value");
    expect(lines).toEqual(["[info] token [REDACTED]"]);

    const loud = createLogger({ debug: true, write: (line) => lines.push(line) });
    loud.debug("shown");
    expect(lines.at(-1)).toBe("[debug] shown");
  });
});
