import path from "node:path";
import { MAX_DESCRIPTION_LENGTH, MIN_DESCRIPTION_LENGTH, PROJECT_NAME_PATTERN } from "../shared/constants.js";
import { ExpressForgeError } from "../shared/errors.js";

/** Returns true when valid, otherwise a message suitable for a prompt. */
export function validateProjectName(value: string): true | string {
  const name = value.trim();
  if (!PROJECT_NAME_PATTERN.test(name)) return "Use letters, numbers, hyphens, or underscores.";
  if (name.length > 214) return "Use 214 characters or fewer.";
  return true;
}

export function validateDescription(value: string): true | string {
  const length = value.trim().length;
  if (length < MIN_DESCRIPTION_LENGTH) return `Please provide at least ${MIN_DESCRIPTION_LENGTH} characters.`;
  if (length > MAX_DESCRIPTION_LENGTH) return `Please use ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
  return true;
}

export function assertValidProjectName(value: string): string {
  const name = value.trim();
  const result = validateProjectName(name);
  if (result !== true) throw new ExpressForgeError("INVALID_INPUT", `Invalid project name "${name}". ${result}`);
  return name;
}

export function assertValidDescription(value: string): string {
  const result = validateDescription(value);
  if (result !== true) throw new ExpressForgeError("INVALID_INPUT", `Invalid project description. ${result}`);
  return value.trim();
}

/** npm package names must be lowercase; the directory name keeps the user's casing. */
export function toPackageName(projectName: string): string {
  return projectName.toLowerCase();
}

/** The project always lives directly inside `cwd`; the name pattern forbids separators and dots. */
export function resolveProjectPath(cwd: string, projectName: string): string {
  const name = assertValidProjectName(projectName);
  const resolved = path.resolve(cwd, name);
  if (path.dirname(resolved) !== path.resolve(cwd)) {
    throw new ExpressForgeError("UNSAFE_PATH", "The project path must be a direct child of the current directory.");
  }
  return resolved;
}
