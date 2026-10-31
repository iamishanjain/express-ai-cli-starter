import path from "node:path";
import { ExpressForgeError } from "../../shared/errors.js";

/**
 * Resolves `relativePath` under `root` and rejects anything that would land
 * outside it (absolute paths, `..` segments, NUL bytes, drive letters).
 */
export function resolveInside(root: string, relativePath: string): string {
  const reject = (): never => {
    throw new ExpressForgeError("UNSAFE_PATH", `Refusing to use unsafe path "${relativePath}".`, {
      hint: "Template paths must stay inside the project directory."
    });
  };

  if (relativePath.length === 0 || relativePath.includes("\0")) reject();
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) reject();

  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    reject();
  return resolved;
}
