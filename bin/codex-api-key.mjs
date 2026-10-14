#!/usr/bin/env node
// Legacy: prints the API key codex uses, for models.json entries written by earlier 2pi versions
// (`"apiKey": "!node .../codex-api-key.mjs"`). `2pi import-codex` now stores a self-contained
// `!node -e ...` credential in auth.json instead, as pi does; re-running it replaces this.
// Usage: codex-api-key.mjs [ENV_KEY]   (ENV_KEY: the provider's `env_key` from codex config.toml)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const envKey = process.argv[2];
if (envKey && process.env[envKey]) {
	process.stdout.write(process.env[envKey]);
	process.exit(0);
}
const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
try {
	const auth = JSON.parse(readFileSync(join(codexHome, "auth.json"), "utf8"));
	if (typeof auth.OPENAI_API_KEY !== "string" || !auth.OPENAI_API_KEY) throw new Error("no OPENAI_API_KEY");
	process.stdout.write(auth.OPENAI_API_KEY);
} catch (error) {
	console.error(`codex-api-key: cannot read OPENAI_API_KEY from ${join(codexHome, "auth.json")}: ${error.message}`);
	process.exit(1);
}
