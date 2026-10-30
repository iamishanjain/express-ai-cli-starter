#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { input, select, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { GeminiProvider } from "./ai/gemini.provider.js";
import { renderProject } from "./core/render-project.js";
import { DatabaseSchema, type DatabaseChoice, type LanguageChoice, ProjectSpecSchema } from "./types/spec.js";

const program = new Command();

program
  .name("create-express-ai")
  .description("Generate an Express API starter, optionally using Gemini to propose data models.")
  .version("0.1.0")
  .action(async () => {
    try {
      console.log(chalk.cyan.bold("\n⚡ Express AI CLI\n"));

      const projectName = (await input({
        message: "Project name:",
        default: "my-express-api",
        validate: (value) => /^[a-z0-9][a-z0-9-_]*$/i.test(value.trim())
          ? true
          : "Use letters, numbers, hyphens, or underscores."
      })).trim();

      const description = await input({
        message: "Describe the project you want to build:",
        validate: (value) => value.trim().length >= 15 || "Please provide at least 15 characters."
      });

      const language = await select<LanguageChoice>({
        message: "Choose project language:",
        choices: [
          { name: "TypeScript", value: "typescript" },
          { name: "JavaScript", value: "javascript" }
        ],
        default: "typescript"
      });

      const database = await select<DatabaseChoice>({
        message: "Choose database:",
        choices: [
          { name: "PostgreSQL", value: "postgresql" },
          { name: "MySQL", value: "mysql" },
          { name: "MongoDB", value: "mongodb" },
          { name: "None", value: "none" }
        ],
        default: "postgresql"
      });

      const useAI = await confirm({
        message: "Use Gemini to propose models and fields?",
        default: Boolean(process.env.GEMINI_API_KEY)
      });

      const absolutePath = path.resolve(process.cwd(), projectName);
      try {
        await fs.access(absolutePath);
        throw new Error(`Directory already exists: ${absolutePath}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Directory already exists:")) throw error;
      }

      let spec;
      if (useAI) {
        const spinner = ora("Asking Gemini to analyze your project...").start();
        try {
          spec = await new GeminiProvider().proposeProjectSpec({ description, database });
          spinner.succeed("Project specification received and validated.");
          console.log(chalk.bold("\nProposed entities:"));
          for (const entity of spec.entities) {
            console.log(`  ${chalk.green(entity.name)} (${entity.tableName})`);
            for (const field of entity.fields) {
              const flags = [
                field.primaryKey ? "PK" : "",
                field.unique ? "unique" : "",
                field.nullable ? "nullable" : "required"
              ].filter(Boolean).join(", ");
              console.log(`    - ${field.name}: ${field.type} [${flags}]`);
            }
          }
          if (spec.assumptions.length) {
            console.log(chalk.yellow("\nAssumptions to review:"));
            for (const assumption of spec.assumptions) console.log(`  - ${assumption}`);
          }
          const approved = await confirm({ message: "Use this schema proposal?", default: true });
          if (!approved) {
            console.log(chalk.yellow("Schema rejected. No project files were created."));
            return;
          }
        } catch (error) {
          spinner.fail("AI schema generation failed.");
          throw error;
        }
      }

      await fs.mkdir(absolutePath, { recursive: false });
      const spinner = ora("Generating project files...").start();
      try {
        await renderProject({ projectPath: absolutePath, projectName, language, database, spec });
        spinner.succeed("Project files generated.");
      } catch (error) {
        await fs.rm(absolutePath, { recursive: true, force: true });
        throw error;
      }

      const install = await confirm({ message: "Install project dependencies now?", default: true });
      if (install) {
        const installSpinner = ora("Installing dependencies...").start();
        const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install"], {
          cwd: absolutePath,
          stdio: "inherit"
        });
        if (result.status !== 0) {
          installSpinner.fail("npm install failed. You can run npm install manually in the project directory.");
        } else {
          installSpinner.succeed("Dependencies installed.");
        }
      }

      console.log(chalk.green.bold("\nProject created successfully!\n"));
      console.log(`  cd ${projectName}`);
      console.log("  npm run dev");
      console.log("\nHealth check: http://localhost:3000/health\n");
      if (useAI && spec) console.log(chalk.gray("The proposed logical schema is saved to src/generated/schema.json."));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`\nError: ${message}\n`));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
