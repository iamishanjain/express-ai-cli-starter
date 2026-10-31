# 3. Template manifests

Status: accepted

## Context

Dependencies, scripts, env keys and file lists were hardcoded in the renderer, with JavaScript and TypeScript sources duplicated.

## Decision

Templates are folders with a validated `template.json`. The engine merges dependencies, scripts, env lines and variables from the selected templates and renders files with a minimal `{{variable}}` substitution. We did not adopt Handlebars or EJS: logic inside templates makes them hard to validate, and substitution is enough. Conflicting values between templates are an error, and unknown variables fail rendering.

## Consequences

- Adding a database or language is a new folder and a test. No engine changes.
- Templates cannot contain conditionals; variation comes from selecting different templates.
- Template `.gitignore` files cannot be shipped through npm, so templates use `gitignore.tpl`.
