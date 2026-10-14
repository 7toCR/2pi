#!/usr/bin/env node
// Install the actual tarball under an isolated global prefix; never touch the user's 2pi.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this script with npm run test:package.");
const workDir = join(root, ".work");
mkdirSync(workDir, { recursive: true });
const sandbox = mkdtempSync(join(workDir, "package-"));
const prefix = join(sandbox, "install");
const cwd = join(sandbox, "project");
mkdirSync(cwd, { recursive: true });
const env = {
	...process.env,
	TWOPI_HOME: join(sandbox, "agent-home"),
	TWOPI_CODING_AGENT_DIR: join(sandbox, "agent-home", "agent"),
	TWOPI_OFFLINE: "1",
	TWOPI_USE_PI_CONFIG: "",
	TWOPI_PATENT_SKILL_DIR: "",
	TWOPI_PAPER_SKILL_DIR: "",
};

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", ...options });
	assert.ifError(result.error);
	assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}

const packed = JSON.parse(run(process.execPath, [npmCli, "pack", "--json", "--pack-destination", sandbox]));
const { filename, files } = packed[0];
const paths = new Set(files.map((file) => file.path));
for (const path of [
	"dist/cli.js", "bin/2pi.mjs", "python/requirements.txt", "templates/2PI.md",
	"skills/paper2patent/SKILL.md", "skills/paper2patent/LICENSE",
	"skills/paper2patent/scripts/generate_patent_docx.py",
	"skills/research2paper/SKILL.md", "skills/research/SKILL.md",
]) assert.ok(paths.has(path), `Missing packed resource: ${path}`);
assert.ok(!files.some(({ path }) => /^(src|test|reference|gudie|\.work|node_modules)\//.test(path)), "Development files leaked into the tarball.");
assert.ok(!files.some(({ path }) => path.includes("__pycache__") || path.endsWith(".pyc")), "Python caches leaked into the tarball.");

run(process.execPath, [
	npmCli, "install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund",
	"--registry", "https://registry.npmjs.org/", join(sandbox, filename),
]);
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const installed = join(prefix, ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", name);
assert.ok(!existsSync(join(installed, "src")), "The smoke test must exercise compiled JavaScript.");
const entry = join(installed, "bin", "2pi.mjs");
assert.match(run(process.execPath, [entry, "--version"], { cwd }), new RegExp(`^2pi ${version.replaceAll(".", "\\.")} `));
assert.match(run(process.execPath, [entry, "--help"], { cwd }), /2pi init/);
run(process.execPath, [entry, "init", "both"], { cwd });
for (const path of ["2PI.md", "paper/main.tex", "paper/sections/methods.tex", "notes/evidence.json", "patent"]) {
	assert.ok(existsSync(join(cwd, path)), `Installed CLI did not create ${path}`);
}
const shim = join(prefix, ...(process.platform === "win32" ? [] : ["bin"]), process.platform === "win32" ? "2pi.cmd" : "2pi");
assert.ok(existsSync(shim), "npm did not create the global 2pi command.");
const shimVersion = process.platform === "win32"
	? run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${shim}" --version"`], { cwd, windowsVerbatimArguments: true })
	: run(shim, ["--version"], { cwd });
assert.match(shimVersion, /^2pi /);
console.log(`Packed global install verified (${files.length} files). Artifacts: ${sandbox}`);
