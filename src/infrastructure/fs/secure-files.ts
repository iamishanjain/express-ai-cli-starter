import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ExpressForgeError } from "../../shared/errors.js";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

/** Writes a file readable only by the current user, replacing any existing file atomically. */
export async function writePrivateFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await fs.chmod(dir, PRIVATE_DIR_MODE).catch(() => undefined);
  const temp = path.join(dir, `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await fs.writeFile(temp, content, { mode: PRIVATE_FILE_MODE, flag: "wx" });
    await fs.rename(temp, filePath);
    await fs.chmod(filePath, PRIVATE_FILE_MODE).catch(() => undefined);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

/** Maps filesystem failures to typed errors without echoing file contents. */
export function toFilesystemError(error: unknown, action: string, location: string): ExpressForgeError {
  if (isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM")) {
    return new ExpressForgeError("FS_PERMISSION", `Permission denied while trying to ${action}.`, {
      hint: `Check the permissions of ${location}.`,
      details: { code: error.code }
    });
  }
  return new ExpressForgeError("FS_PERMISSION", `Could not ${action}.`, {
    hint: `Check that ${location} is writable.`,
    details: { code: isNodeError(error) ? error.code : undefined },
    cause: error
  });
}
