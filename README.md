# Express AI CLI — starter MVP

A TypeScript CLI that asks about a project, optionally uses Gemini to propose a validated data model specification, and generates a starter Express project.

## Requirements

- Node.js 20+
- npm
- A Gemini API key only if you want AI schema suggestions

## Setup

```bash
npm install
cp .env.example .env
# Add GEMINI_API_KEY to .env if using AI
npm run dev
```

The CLI loads a local `.env` file through `dotenv/config`. Copy `.env.example` to `.env` and add your Gemini API key.

macOS/Linux:
```bash
cp .env.example .env
# Edit .env and set GEMINI_API_KEY
npm run dev
```

PowerShell:
```powershell
Copy-Item .env.example .env
# Edit .env and set GEMINI_API_KEY
npm run dev
```

## Build and use as a local CLI

```bash
npm run build
npm link
create-express-ai
```

Or run with:
```bash
npm run dev -- --help
```

## Current MVP behavior

- Prompts for project name, description, JavaScript/TypeScript, and database.
- Optionally calls Gemini for a structured model proposal.
- Validates AI output with Zod.
- Writes a starter Express app, `.env.example`, and `src/generated/schema.json`.
- Offers to install generated project dependencies.

## Important scope note

This is a starting implementation, not a production-ready generator. It currently generates the logical schema proposal as JSON; it does not yet translate it into database migrations or complete ORM models. Add and test database adapters before using generated schemas in production. Google OAuth, JWT auth, and deployment are subsequent modules.
