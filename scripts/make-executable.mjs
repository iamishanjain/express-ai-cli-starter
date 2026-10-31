import { chmodSync } from "node:fs";

// npm sets the executable bit on install, but a local `npm link` or `node dist/...` run benefits too.
chmodSync(new URL("../dist/bin/main.js", import.meta.url), 0o755);
