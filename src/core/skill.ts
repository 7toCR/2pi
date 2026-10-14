import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { slash } from "./paths.ts";

/** A domain skill used as the agent's knowledge base: rules in SKILL.md, detail in references/. */
export interface SkillKnowledge {
	name: string;
	dir: string;
	/** Frontmatter description: what the skill is for. */
	description: string;
	/** SKILL.md without frontmatter, with skill-relative paths made absolute. */
	body: string;
	references: Array<{ name: string; path: string; guide: string }>;
	assetsDir: string;
	scriptsDir: string;
}

function firstHeading(path: string): string {
	const line = readFileSync(path, "utf8")
		.split(/\r?\n/)
		.find((text) => text.startsWith("# "));
	return line ? line.slice(2).trim() : basename(path);
}

function frontmatterField(frontmatter: string, field: string): string {
	const match = new RegExp(`^${field}:\\s*(.*)$`, "m").exec(frontmatter);
	return (match?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Load a skill directory. `guide` says when to read each reference, in the order a task needs
 * them; references it does not name are listed last, described by their first heading.
 */
export function loadSkill(skillDir: string, guide: Record<string, string> = {}): SkillKnowledge {
	const root = slash(skillDir);
	const raw = readFileSync(join(skillDir, "SKILL.md"), "utf8").replace(/^﻿/, "");
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
	const body = raw
		.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
		.trim()
		.replace(/`<skill>\//g, `\`${root}/`)
		.replace(/<skill>\//g, `${root}/`)
		.replace(/`(references|assets|scripts)\//g, `\`${root}/$1/`);

	const priority = (name: string): number => {
		const index = Object.keys(guide).indexOf(name);
		return index < 0 ? Number.MAX_SAFE_INTEGER : index;
	};
	const referencesDir = join(skillDir, "references");
	const references = existsSync(referencesDir)
		? readdirSync(referencesDir)
				.filter((name) => name.endsWith(".md"))
				.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b))
				.map((name) => ({
					name,
					path: slash(join(referencesDir, name)),
					guide: guide[name] ?? firstHeading(join(referencesDir, name)),
				}))
		: [];

	return {
		name: frontmatterField(frontmatter, "name") || basename(skillDir),
		dir: root,
		description: frontmatterField(frontmatter, "description"),
		body,
		references,
		assetsDir: slash(join(skillDir, "assets")),
		scriptsDir: slash(join(skillDir, "scripts")),
	};
}

/** The reference index shown to the model: absolute paths plus when to read each file. */
export function referenceIndex(skill: SkillKnowledge, extra: Array<{ path: string; guide: string }> = []): string {
	const items = [...skill.references, ...extra].map((ref) => `- ${ref.path}\n  ${ref.guide}`);
	return `知识库目录：${skill.dir}（只读）。按需用 read 读取，读就读完整个文件：\n${items.join("\n")}`;
}
