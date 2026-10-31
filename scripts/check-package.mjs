// Verifies what `npm publish` would ship. Run after `npm run build`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32"
});
const [report] = JSON.parse(output);
const files = report.files.map((file) => file.path);
const problems = [];

const required = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "dist/bin/main.js",
  "dist/index.js",
  "dist/index.d.ts",
  "templates/base/template.json",
  "templates/base/files/gitignore.tpl"
];
for (const path of required) if (!files.includes(path)) problems.push(`missing from package: ${path}`);

const forbidden = [
  /^src\//,
  /^tests\//,
  /^scripts\//,
  /^docs\//,
  /^\.github\//,
  /(^|\/)\.env/,
  /(^|\/)node_modules\//,
  /(^|\/)credentials\.json$/,
  /(^|\/)config\.json$/,
  /\.tsbuildinfo$/,
  /\.log$/,
  /^coverage\//,
  /^tsconfig/,
  /^vitest\.config/,
  /^eslint\.config/
];
for (const path of files) {
  if (forbidden.some((pattern) => pattern.test(path))) problems.push(`must not be published: ${path}`);
}

// A published .gitignore is renamed by npm, so templates must not rely on one.
if (files.some((path) => path.startsWith("templates/") && /(^|\/)\.gitignore$/.test(path))) {
  problems.push("templates must not contain a .gitignore (npm drops it); use gitignore.tpl");
}

for (const [name, target] of Object.entries(manifest.bin)) {
  const normalized = target.replace(/^\.\//, "");
  if (!files.includes(normalized)) problems.push(`bin "${name}" points to ${target}, which is not in the package`);
  else if (!existsSync(new URL(normalized, root))) problems.push(`bin "${name}" target is missing on disk`);
}

const text = (path) => readFileSync(new URL(path, root), "utf8");
if (!text("dist/bin/main.js").startsWith("#!/usr/bin/env node")) problems.push("dist/bin/main.js has no node shebang");
const secretPattern = /AIza[0-9A-Za-z_-]{30,}/;
for (const path of files.filter((path) => path.endsWith(".js") || path.endsWith(".json") || path.endsWith(".tpl"))) {
  if (secretPattern.test(text(path))) problems.push(`possible API key in ${path}`);
}

console.log(
  `${report.name}@${report.version}: ${files.length} files, ${(report.size / 1024).toFixed(1)} kB packed, ${(report.unpackedSize / 1024).toFixed(1)} kB unpacked`
);
if (problems.length > 0) {
  console.error(`\nPackage check FAILED:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("Package check passed.");
