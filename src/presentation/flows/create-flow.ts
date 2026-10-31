import fs from "node:fs/promises";
import chalk from "chalk";
import { analyzeProject } from "../../application/analyze-project.js";
import type { ProjectOptions, TemplateChoice } from "../../application/ports.js";
import {
  assertValidDescription,
  assertValidProjectName,
  resolveProjectPath,
  validateDescription,
  validateProjectName
} from "../../application/project.js";
import type { ProjectSpec } from "../../domain/project-spec.js";
import { ExpressForgeError, isExpressForgeError } from "../../shared/errors.js";
import type { CliContext } from "../context.js";
import { formatError } from "../ui/format-error.js";
import { configureProvider, runFirstRunSetup } from "./setup-flow.js";

export interface CreateFlags {
  name?: string;
  description?: string;
  language?: string;
  database?: string;
  provider?: string;
  model?: string;
  /** true = --ai, false = --no-ai, undefined = decide interactively. */
  ai?: boolean;
  /** Explicit pre-approval of the AI schema for non-interactive runs. */
  approveSchema?: boolean;
  install?: boolean;
  yes?: boolean;
}

const DEFAULT_PROJECT_NAME = "my-express-api";

export async function runCreate(ctx: CliContext, flags: CreateFlags): Promise<void> {
  const interactive = ctx.isInteractive && flags.yes !== true;
  ctx.ui.heading("\n⚡ ExpressForge\n");

  const languages = await ctx.catalog.choices("language");
  const databases = await ctx.catalog.choices("database");
  validateChoiceFlag("language", flags.language, languages);
  validateChoiceFlag("database", flags.database, databases);
  validateAiFlags(flags, interactive);

  const settings = await ctx.settings.resolve({ provider: flags.provider, model: flags.model });
  const providerName = ctx.registry.get(settings.providerId).metadata.displayName;

  let aiAvailable = await hasCredentials(ctx, settings.providerId, settings.aiEnabled === true);
  if (flags.ai !== false && !aiAvailable && interactive) {
    if (flags.ai === true) {
      aiAvailable = await configureProvider(ctx, { providerId: settings.providerId, model: flags.model });
    } else if (settings.aiEnabled === undefined) {
      aiAvailable = await runFirstRunSetup(ctx);
    }
  }
  if (flags.ai === true && !aiAvailable) {
    await ctx.credentials.resolve(settings.providerId); // throws MISSING_API_KEY with guidance
  }

  const projectName = await pickName(ctx, flags, interactive);
  const wantsDescription = flags.ai === true || (aiAvailable && flags.ai !== false);
  const description = wantsDescription ? await pickDescription(ctx, flags, interactive) : undefined;
  const language = await pickChoice(ctx, interactive, flags, "language", "Choose project language:", languages);
  const database = await pickChoice(ctx, interactive, flags, "database", "Choose database:", databases);

  const useAi = await decideUseAi(ctx, flags, interactive, aiAvailable, providerName);

  const projectPath = resolveProjectPath(ctx.cwd, projectName);
  await ctx.generator.assertAvailable(projectPath);

  let spec: ProjectSpec | undefined;
  if (useAi) {
    if (description === undefined)
      throw new ExpressForgeError("INTERNAL", "A project description is required for AI analysis.");
    spec = await proposeSpec(ctx, {
      providerId: settings.providerId,
      model: settings.model,
      description,
      database,
      providerName
    });
    const approved = await approve(ctx, spec, flags, interactive);
    if (!approved) {
      ctx.ui.warn("Schema rejected. No project files were created.");
      return;
    }
  }

  const options: ProjectOptions = { projectName, language, database };
  await generate(ctx, { options, projectPath, spec });

  const install =
    flags.install ??
    (interactive ? await ctx.prompter.confirm({ message: "Install project dependencies now?", default: true }) : false);
  if (install) await installDependencies(ctx, projectPath);

  printNextSteps(ctx, projectName, spec !== undefined);
}

function validateChoiceFlag(kind: string, value: string | undefined, choices: readonly TemplateChoice[]): void {
  if (value === undefined || choices.some((choice) => choice.value === value)) return;
  throw new ExpressForgeError("INVALID_INPUT", `Unsupported ${kind} "${value}".`, {
    hint: `Choose one of: ${choices.map((choice) => choice.value).join(", ")}.`
  });
}

function validateAiFlags(flags: CreateFlags, interactive: boolean): void {
  if (!interactive && flags.ai === true) {
    if (!flags.description) {
      throw new ExpressForgeError("NON_INTERACTIVE", "--ai needs --description when prompts are unavailable.");
    }
    if (!flags.approveSchema) {
      throw new ExpressForgeError(
        "NON_INTERACTIVE",
        "An AI-proposed schema must be approved before files are written.",
        {
          hint: "Pass --approve-schema to pre-approve the validated proposal, or use --no-ai."
        }
      );
    }
  }
}

async function hasCredentials(ctx: CliContext, providerId: string, warnOnProblem: boolean): Promise<boolean> {
  const inspection = await ctx.credentials.inspect(providerId);
  if (inspection.problem && warnOnProblem)
    ctx.ui.warn(`${inspection.problem.message} ${inspection.problem.hint ?? ""}`.trim());
  return inspection.source !== "none";
}

async function pickName(ctx: CliContext, flags: CreateFlags, interactive: boolean): Promise<string> {
  if (flags.name !== undefined) return assertValidProjectName(flags.name);
  if (interactive) {
    return (
      await ctx.prompter.input({
        message: "Project name:",
        default: DEFAULT_PROJECT_NAME,
        validate: validateProjectName
      })
    ).trim();
  }
  if (flags.yes) return DEFAULT_PROJECT_NAME;
  throw missing("--name");
}

async function pickDescription(ctx: CliContext, flags: CreateFlags, interactive: boolean): Promise<string> {
  if (flags.description !== undefined) return assertValidDescription(flags.description);
  if (interactive) {
    return ctx.prompter.input({ message: "Describe the project you want to build:", validate: validateDescription });
  }
  throw missing("--description");
}

async function pickChoice(
  ctx: CliContext,
  interactive: boolean,
  flags: CreateFlags,
  kind: "language" | "database",
  message: string,
  choices: readonly TemplateChoice[]
): Promise<string> {
  if (flags[kind] !== undefined) return flags[kind];
  const fallback = choices.find((choice) => choice.isDefault) ?? choices[0];
  if (!fallback) throw new ExpressForgeError("TEMPLATE_NOT_FOUND", `No ${kind} templates are installed.`);
  if (!interactive) {
    if (flags.yes) return fallback.value;
    throw missing(`--${kind}`);
  }
  return ctx.prompter.select({
    message,
    choices: choices.map((choice) => ({ name: choice.label, value: choice.value })),
    default: fallback.value
  });
}

async function decideUseAi(
  ctx: CliContext,
  flags: CreateFlags,
  interactive: boolean,
  aiAvailable: boolean,
  providerName: string
): Promise<boolean> {
  if (flags.ai === false) return false;
  if (flags.ai === true) return true;
  if (!interactive || !aiAvailable) return false;
  return ctx.prompter.confirm({ message: `Use ${providerName} to propose models and fields?`, default: true });
}

async function proposeSpec(
  ctx: CliContext,
  input: { providerId: string; model: string; description: string; database: string; providerName: string }
): Promise<ProjectSpec> {
  const { description } = input;
  const provider = await ctx.factory.create(input.providerId, { model: input.model });
  const spinner = ctx.ui.spinner(`Asking ${input.providerName} to analyze your project...`);
  try {
    const spec = await analyzeProject(provider, { description, database: input.database }, ctx.signal);
    spinner.succeed("Project specification received and validated.");
    return spec;
  } catch (error) {
    spinner.fail("AI schema generation failed.");
    throw error;
  }
}

async function approve(ctx: CliContext, spec: ProjectSpec, flags: CreateFlags, interactive: boolean): Promise<boolean> {
  ctx.ui.line(chalk.bold("\nProposed entities:"));
  for (const entity of spec.entities) {
    ctx.ui.line(`  ${chalk.green(entity.name)} (${entity.tableName})`);
    for (const field of entity.fields) {
      const attributes = [
        field.primaryKey ? "PK" : "",
        field.unique ? "unique" : "",
        field.nullable ? "nullable" : "required"
      ]
        .filter(Boolean)
        .join(", ");
      ctx.ui.line(`    - ${field.name}: ${field.type} [${attributes}]`);
    }
  }
  if (spec.assumptions.length > 0) {
    ctx.ui.line(chalk.yellow("\nAssumptions to review:"));
    for (const assumption of spec.assumptions) ctx.ui.line(`  - ${assumption}`);
  }
  if (!interactive) return flags.approveSchema === true;
  return ctx.prompter.confirm({ message: "Use this schema proposal?", default: true });
}

async function generate(
  ctx: CliContext,
  request: { options: ProjectOptions; projectPath: string; spec: ProjectSpec | undefined }
): Promise<void> {
  const spinner = ctx.ui.spinner("Generating project files...");
  try {
    await ctx.generator.generate(request);
  } catch (error) {
    spinner.fail("Project generation failed.");
    throw error;
  }
  if (ctx.signal.aborted) {
    await fs.rm(request.projectPath, { recursive: true, force: true });
    spinner.fail("Cancelled.");
    throw new ExpressForgeError("CANCELLED", "Cancelled. The generated files were removed.");
  }
  spinner.succeed("Project files generated.");
}

async function installDependencies(ctx: CliContext, projectPath: string): Promise<void> {
  const spinner = ctx.ui.spinner("Installing dependencies...");
  try {
    await ctx.installer.install(projectPath, ctx.signal);
    spinner.succeed("Dependencies installed.");
  } catch (error) {
    spinner.fail("npm install failed. You can run npm install manually in the project directory.");
    if (ctx.signal.aborted)
      throw new ExpressForgeError(
        "CANCELLED",
        "Cancelled. The project was created but dependencies were not installed."
      );
    if (isExpressForgeError(error)) for (const line of formatError(error, ctx.debug).lines) ctx.ui.error(line);
  }
}

function printNextSteps(ctx: CliContext, projectName: string, hasSpec: boolean): void {
  ctx.ui.line(chalk.green.bold("\nProject created successfully!\n"));
  ctx.ui.line(`  cd ${projectName}`);
  ctx.ui.line("  npm run dev");
  ctx.ui.line("\nHealth check: http://localhost:3000/health\n");
  if (hasSpec) ctx.ui.line(chalk.gray("The proposed logical schema is saved to src/generated/schema.json."));
}

function missing(flag: string): ExpressForgeError {
  return new ExpressForgeError("NON_INTERACTIVE", `${flag} is required when prompts are unavailable.`, {
    hint: "Pass it as a flag, or use --yes to accept defaults."
  });
}
