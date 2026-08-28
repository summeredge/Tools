import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await rm(resolve("dist", "index.html"), { force: true });
await rm(resolve("dist", "assets"), { recursive: true, force: true });

const serverDirectory = resolve("dist", "server");
await mkdir(serverDirectory, { recursive: true });

await writeFile(
  resolve(serverDirectory, "index.js"),
  `export default {\n  async fetch(request, env) {\n    return env.ASSETS.fetch(request);\n  },\n};\n`,
  "utf8",
);

await writeFile(
  resolve(serverDirectory, "wrangler.json"),
  `${JSON.stringify({
    name: "daily-workbench",
    main: "index.js",
    compatibility_date: "2026-05-15",
    compatibility_flags: ["nodejs_compat"],
    no_bundle: true,
    assets: { directory: "../client" },
    observability: { enabled: true },
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
  }, null, 2)}\n`,
  "utf8",
);

console.log("Created Sites Worker entrypoint in dist/server.");
