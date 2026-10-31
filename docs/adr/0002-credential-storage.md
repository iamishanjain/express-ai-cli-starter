# 2. Credential storage

Status: accepted

## Context

API keys must not live in plaintext config files or generated projects, and users should not have to edit `.env` files. Node has no built-in credential store.

## Decision

- Store keys in the OS credential store via `@napi-rs/keyring` (prebuilt binaries, maintained). It is an optional dependency and loaded lazily, so a missing binary produces a typed error instead of a crash. (`keytar` is archived and needs native compilation.)
- Behind a `CredentialStore` port, with a file implementation (`0600`) that is used only with explicit consent. A silent fallback is rejected: the user would believe the key is safer than it is.
- Environment variables override stored keys, for CI.
- Keys are never accepted as CLI arguments. `--stdin` serves scripts.
- Everything printed passes through a redactor that masks registered secrets and common key shapes.

## Consequences

- Headless Linux without Secret Service needs an environment variable or the explicit file opt-in.
- The file fallback is plaintext. It is documented as such.
