# Contributing to ExpressForge

Thanks for helping! This guide gets you from clone to pull request. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

You need Node.js 20+ and npm.

```bash
git clone https://github.com/iamishanjain/express-ai-cli-starter.git
cd express-ai-cli-starter
npm install
```

## Run, test, build

| Task                          | Command                                  |
| ----------------------------- | ---------------------------------------- |
| Run the CLI from source       | `npm run dev -- --help` or `npm run dev` |
| Unit tests                    | `npm run test:unit`                      |
| Integration and CLI tests     | `npm run test:integration`               |
| All tests                     | `npm test`                               |
| Type check                    | `npm run typecheck`                      |
| Lint / format check           | `npm run lint` / `npm run format:check`  |
| Fix formatting                | `npm run format`                         |
| Build                         | `npm run build`                          |
| Check what would be published | `npm run build && npm run check:package` |

Tests never need a real API key or network access: the AI SDK is mocked, the keychain is faked, and every test uses temporary directories. Please keep it that way.

To try your build as a real command: `npm run build && npm link`, then run `expressforge`. Use a throwaway config directory so you do not touch your real settings: `EXPRESSFORGE_CONFIG_DIR=/tmp/ef-dev expressforge`.

## How the code is organised

```text
src/
  domain/          pure rules: ProjectSpec schema, AIProvider contract
  application/     use cases and ports (interfaces); no SDKs, no fs
  infrastructure/  adapters: Gemini, keychain, config files, templates, npm
  presentation/    commands, prompts, terminal output
  shared/          errors, logger, redaction, constants
  composition.ts   the one place where implementations are wired together
templates/         files that make up generated projects
```

Dependencies point inward only (presentation → application → domain, and infrastructure implements application ports). ESLint enforces this, so a wrong import fails `npm run lint`. Read [docs/architecture.md](docs/architecture.md) for the details.

## Add an AI provider

Core code must never contain `if (provider === "x")`. Everything provider-specific lives in one folder.

1. **Create the adapter** in `src/infrastructure/providers/<id>/<id>-provider.ts`. Implement `AIProvider` and export a `ProviderDefinition`:

   ```ts
   export const exampleDefinition: ProviderDefinition = {
     metadata: {
       id: "example",
       displayName: "Example AI",
       envVar: "EXAMPLE_API_KEY",
       defaultModel: "example-1",
       credentialHint: "Create a key at https://example.com/keys"
     },
     create: (context) => new ExampleProvider(context) // context: { apiKey, model, timeoutMs }
   };
   ```

2. **Implement the contract** (`src/domain/ai-provider.ts`):
   - `validateCredentials()` makes the cheapest possible request and throws a typed error if the key is bad.
   - `proposeProjectSpec()` returns data that passes `parseProjectSpec` (call it yourself on the parsed response).
   - `listModels()` is optional.
3. **Map errors to `ExpressForgeError` codes** (`INVALID_API_KEY`, `RATE_LIMITED`, `NETWORK_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `UNSUPPORTED_MODEL`, ...). **Never forward the SDK's raw message**: it can echo request details. See `mapGeminiError` for the pattern. Honour `timeoutMs` and the `AbortSignal`.
4. **Register it** in `src/composition.ts` by adding it to the default provider list.
5. **Keep the SDK contained.** Import the SDK only inside your provider folder. Add it to the restricted imports in `eslint.config.js`, as is done for `@google/genai`.
6. **Test it** like `tests/unit/gemini-provider.test.ts`: inject a fake client, cover success, empty/invalid responses, each error mapping, timeout, and that no error contains the key. The registry and CLI tests need no changes.
7. **Document it** in the README and add a CHANGELOG entry.

## Add a project template

Templates are folders under `templates/`; the engine discovers them, so you normally change no code.

```text
templates/<category>/<option>/template.json    # category is "language" or "database"
templates/<category>/<option>/files/...        # optional files
```

Example `templates/database/sqlite/template.json`:

```json
{
  "manifestVersion": 1,
  "id": "database/sqlite",
  "version": "1.0.0",
  "category": "database",
  "option": "sqlite",
  "label": "SQLite",
  "order": 5,
  "dependencies": { "better-sqlite3": "^11.0.0" },
  "env": ["SQLITE_PATH=./data/app.db"]
}
```

- `id` must equal `<category>/<option>` and the folder path.
- `dependencies`, `devDependencies`, `scripts`, `env` and `variables` are merged with the other selected templates. Two templates setting the same key to different values is an error.
- `files` entries are `{ "from": "files/x.tpl", "to": "src/x.{{ext}}" }`. Files may use `{{name}}` placeholders (`projectName`, `projectNameJson`, `packageName`, `language`, `database`, plus any `variables`). An unknown placeholder fails the build of the project.
- Do not name a template file `.gitignore`: npm drops it when publishing. Use `gitignore.tpl` and set `to` to `.gitignore`.
- Output paths are validated to stay inside the project and files are never overwritten.
- Add a test in `tests/integration/generation.test.ts` that generates a project and asserts the new files and dependencies.

Adding a **new category** (for example `framework`) also needs a prompt in `src/presentation/flows/create-flow.ts`; ask in an issue first.

## Coding standards

- TypeScript strict mode; no `any`; avoid type assertions.
- One responsibility per module; prefer small functions and early returns.
- Depend on interfaces (ports), not concrete classes, across layers.
- Validate everything that comes from outside (flags, files, AI output, API responses).
- Never print, log or store secrets. Anything shown to users goes through the redactor. Errors are `ExpressForgeError` with a code, a safe message and a hint.
- Don't add dependencies without a clear reason; mention it in the PR.
- Prettier and ESLint decide style. Run `npm run format` before committing.

## Submit a pull request

1. Open an issue first for anything large, so we can agree on the approach.
2. Branch from `master`: `git switch -c feat/short-description`.
3. Make your change with tests. A bug fix starts with a failing test.
4. Run `npm run typecheck && npm run lint && npm test && npm run build && npm run check:package`.
5. Add a line to `CHANGELOG.md` under "Unreleased".
6. Commit with a clear message (we like [Conventional Commits](https://www.conventionalcommits.org/), for example `feat: add ollama provider`).
7. Open the PR and fill in the template. CI must pass.

## Reporting security issues

Please do **not** open a public issue. See [SECURITY.md](SECURITY.md).
