const REDACTED = "[REDACTED]";
const MIN_SECRET_LENGTH = 8;

const secrets = new Set<string>();

const PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{30,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /([?&](?:key|api_key|apikey|token)=)[^&\s"']+/gi
];

/** Registers a secret value so it is masked in every later `redact` call. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= MIN_SECRET_LENGTH) secrets.add(value);
}

export function clearRegisteredSecrets(): void {
  secrets.clear();
}

/** Masks registered secrets and well-known credential shapes inside free text. */
export function redact(text: string): string {
  let result = text;
  for (const secret of secrets) result = result.split(secret).join(REDACTED);
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, (_match, prefix?: string) =>
      typeof prefix === "string" ? `${prefix}${REDACTED}` : REDACTED
    );
  }
  return result;
}
