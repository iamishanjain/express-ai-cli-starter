# 4. Schema approval when prompts are unavailable

Status: accepted

## Context

An AI-proposed schema must be approved by the user before files are written. In CI there is nobody to ask.

## Decision

In non-interactive mode AI is used only with `--ai`, and the proposal must be pre-approved with `--approve-schema`. Without it, the command fails before calling the provider. The proposal is still validated and is only ever written as data (`schema.json`), never executed.

## Consequences

- Scripts opt in explicitly. Nothing silently spends API quota or accepts AI output.
