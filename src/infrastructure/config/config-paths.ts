import os from "node:os";
import path from "node:path";
import { APP_NAME, CONFIG_DIR_ENV } from "../../shared/constants.js";

export interface PathContext {
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  homedir: string;
}

export function currentPathContext(): PathContext {
  return { env: process.env, platform: process.platform, homedir: os.homedir() };
}

/** User-specific config directory following each platform's convention. */
export function getConfigDir(context: PathContext = currentPathContext()): string {
  const override = context.env[CONFIG_DIR_ENV]?.trim();
  if (override) return path.resolve(override);

  switch (context.platform) {
    case "darwin":
      return path.join(context.homedir, "Library", "Application Support", APP_NAME);
    case "win32":
      return path.join(context.env.APPDATA ?? path.join(context.homedir, "AppData", "Roaming"), APP_NAME);
    default:
      return path.join(context.env.XDG_CONFIG_HOME ?? path.join(context.homedir, ".config"), APP_NAME);
  }
}
