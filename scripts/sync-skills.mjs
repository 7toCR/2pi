#!/usr/bin/env node
// Vendor skills that live in other repositories into skills/, so 2pi is self-contained.
// The source repository stays canonical: edit the skill there, then run this script again.
//   node scripts/sync-skills.mjs [research2paper-repo]   (default: reference/research2paper)
//   node scripts/sync-skills.mjs --patent <paper2patent-repo>
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patentOnly = process.argv[2] === "--patent";
if (patentOnly && !process.argv[3]) {
	console.error("Usage: node scripts/sync-skills.mjs --patent <paper2patent-repo>");
	process.exit(1);
}
const skillName = patentOnly ? "paper2patent" : "research2paper";
const repo = resolve(patentOnly ? process.argv[3] : (process.argv[2] ?? join(agentRoot, "reference", "research2paper")));
const source = join(repo, "skills", skillName);
const target = join(agentRoot, "skills", skillName);
const templates = join(repo, "agent", "templates", "latex");
const templatesTarget = join(agentRoot, "templates", "paper", "latex");

if (!existsSync(join(source, "SKILL.md"))) {
	console.error(`No ${skillName} skill at ${source}. Pass the ${skillName} repository path.`);
	process.exit(1);
}

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (name === "__pycache__") return [];
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

/** Content hash of a directory: a stable identifier when the source has no git history. */
function digest(dir) {
	const hash = createHash("sha256");
	for (const path of files(dir).sort()) {
		hash.update(relative(dir, path).replace(/\\/g, "/"));
		hash.update(readFileSync(path));
	}
	return hash.digest("hex").slice(0, 16);
}

if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
	throw new Error(`Refusing to replace a linked skill directory: ${target}`);
}
if (source === target) throw new Error("The source and vendored skill directories must differ.");
if (patentOnly && !existsSync(join(source, "LICENSE")) && !existsSync(join(repo, "LICENSE"))) {
	throw new Error("The patent skill source must include a LICENSE for redistribution.");
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true, filter: (path) => !path.includes("__pycache__") });
if (patentOnly) {
	if (!existsSync(join(target, "LICENSE"))) cpSync(join(repo, "LICENSE"), join(target, "LICENSE"));
} else {
	rmSync(templatesTarget, { recursive: true, force: true });
	cpSync(templates, templatesTarget, { recursive: true });
	cpSync(join(repo, "agent", "templates", "memo.md"), join(agentRoot, "templates", "paper", "memo.md"));
}

const manifestPath = join(agentRoot, "skills", "SOURCES.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
manifest[skillName] = {
	source: patentOnly
		? "github.com/7toCR/paper2patent (skills/paper2patent)"
		: "github.com/7toCR/research2paper (skills/research2paper, agent/templates)",
	digest: digest(target),
	syncedAt: new Date().toISOString().slice(0, 10),
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Synced ${skillName} skill (${manifest[skillName].digest})${patentOnly ? "." : " and LaTeX templates."}`);
