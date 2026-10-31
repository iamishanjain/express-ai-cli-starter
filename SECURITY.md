# Security Policy

## Supported versions

Security fixes are released for the latest minor version.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private reporting: [Report a vulnerability](https://github.com/iamishanjain/express-ai-cli-starter/security/advisories/new).

Include what you found, steps to reproduce, the affected version, and the impact you expect. You can expect an acknowledgement within a few days and a status update as the fix progresses. We will credit you in the release notes unless you prefer otherwise.

## What we consider in scope

- Leaking an API key (to the terminal, logs, error messages, config files, generated projects, or the npm package)
- Writing outside the intended project directory, or overwriting existing files
- Command injection through project names, flags, templates or AI output
- Executing or trusting AI-generated content without validation
- Weakening credential storage without the user's explicit consent

## Security model in brief

- API keys live in the OS credential store. A plaintext file fallback exists only with explicit consent, mode `0600`, and is documented as unencrypted.
- Keys are never accepted as command-line arguments, never logged, and are redacted from errors and debug output.
- AI output is untrusted: it is schema-validated, length-limited, sanitized, shown to the user for approval, and saved only as data.
- Template and output paths are validated to stay inside the project directory; existing files are never overwritten.
- `npm install` runs without a shell and with a fixed argument list.
- Releases are published from CI with npm provenance.

If you think an API key may have been exposed, revoke it with your provider immediately, then run `expressforge config set` to store a new one.
