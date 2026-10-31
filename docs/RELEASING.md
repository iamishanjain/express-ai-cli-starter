# Release checklist

Releases are published by CI (`.github/workflows/publish.yml`) using npm trusted publishing with provenance. Nobody publishes from a laptop.

## One-time setup

- [ ] On npmjs.com, add a **trusted publisher** for the `expressforge` package: repository `iamishanjain/express-ai-cli-starter`, workflow `publish.yml`, environment `npm`. (The package must exist; for the very first publish, do a manual `npm publish` of `0.2.0` with 2FA, then enable trusted publishing.)
- [ ] In GitHub, create an environment named `npm` with required reviewers. Restrict it to the `master` branch and `v*` tags.
- [ ] Enable branch protection on `master`: require the CI checks and a review.
- [ ] Enable private vulnerability reporting.

## Every release

1. [ ] `git switch master && git pull`; working tree clean.
2. [ ] Move the "Unreleased" entries in `CHANGELOG.md` under the new version and date; update the compare links.
3. [ ] `npm version <patch|minor|major> --no-git-tag-version`, review `package.json`.
4. [ ] Run the full check locally:
   ```bash
   npm ci && npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run check:package
   ```
5. [ ] Inspect the package: `npm pack --dry-run`. Confirm there are no `src/`, tests, `.env`, credentials or local config files.
6. [ ] Smoke test the tarball:
   ```bash
   npm pack --pack-destination /tmp/ef && npm install -g --prefix /tmp/ef-global /tmp/ef/expressforge-<version>.tgz
   /tmp/ef-global/bin/expressforge --version
   npx --package=/tmp/ef/expressforge-<version>.tgz expressforge providers list
   ```
7. [ ] Generate a project with each language and install and run it (`npm install && npm run dev`, then `curl localhost:3000/health`).
8. [ ] Commit (`chore: release v<version>`), push, and open a PR. Merge after CI passes.
9. [ ] Tag the merge commit: `git tag v<version> && git push origin v<version>`.
10. [ ] Create a GitHub Release from the tag. Publishing the release triggers the workflow; approve the `npm` environment when prompted.
11. [ ] Verify: `npm view expressforge version`, the provenance badge on npm, and `npx expressforge@latest --version`.
12. [ ] If something is wrong, `npm deprecate expressforge@<version> "reason"` and ship a patch. Do not unpublish.
