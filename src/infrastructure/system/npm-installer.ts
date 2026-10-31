import { spawn } from "node:child_process";
import type { PackageInstaller } from "../../application/ports.js";
import { ExpressForgeError } from "../../shared/errors.js";
import { redact } from "../../shared/redact.js";

const OUTPUT_TAIL_LINES = 8;

/**
 * Runs `npm install` without a shell and with a fixed argument list, so nothing
 * user-provided is ever interpolated into a command line.
 */
export class NpmInstaller implements PackageInstaller {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  install(cwd: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const isWindows = this.platform === "win32";
      // Node refuses to spawn .cmd files directly on Windows; the shell is only used
      // there and the arguments are constants.
      const child = spawn(isWindows ? "npm.cmd" : "npm", ["install"], {
        cwd,
        shell: isWindows,
        stdio: ["ignore", "pipe", "pipe"],
        signal
      });

      let tail: string[] = [];
      const remember = (chunk: Buffer): void => {
        tail = [...tail, ...chunk.toString().split(/\r?\n/).filter(Boolean)].slice(-OUTPUT_TAIL_LINES);
      };
      child.stdout.on("data", remember);
      child.stderr.on("data", remember);

      child.on("error", (error) =>
        reject(
          new ExpressForgeError("INSTALL_FAILED", "Could not run npm.", {
            hint: "Make sure npm is installed, then run `npm install` in the project directory.",
            details: { code: (error as NodeJS.ErrnoException).code },
            cause: error
          })
        )
      );
      child.on("close", (code) => {
        if (code === 0) return resolve();
        reject(
          new ExpressForgeError("INSTALL_FAILED", `npm install failed (exit code ${code ?? "unknown"}).`, {
            hint: "Run `npm install` in the project directory to see the full output.",
            details: { exitCode: code ?? undefined, output: redact(tail.join(" | ")) }
          })
        );
      });
    });
  }
}
