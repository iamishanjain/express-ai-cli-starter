## What does this change and why?

<!-- Link the issue: Fixes #123 -->

## How was it tested?

- [ ] `npm run typecheck && npm run lint && npm test` pass
- [ ] Added or updated tests (no real API key or network needed)
- [ ] For packaging changes: `npm run build && npm run check:package`

## Checklist

- [ ] No secrets are printed, logged, stored in plaintext, or written to generated projects
- [ ] New external input (flags, files, AI output) is validated
- [ ] Layering is respected (lint passes); provider SDKs stay inside their adapter folder
- [ ] Docs updated if behavior changed (README, CONTRIBUTING)
- [ ] Added a line to the "Unreleased" section of `CHANGELOG.md`
