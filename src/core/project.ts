import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AGENT_ROOT } from "./config.ts";

/** The project card: what 2pi should know about the work in this directory. */
export const PROJECT_FILE = "2PI.md";
/** Agent state inside a project: sources, checkpoints, change sets. Never part of a deliverable. */
export const STATE_DIR = ".2pi";
/** The model's own temporary files (extracted text, check scripts, crops). Not checkpointed. */
export const SCRATCH_DIR = `${STATE_DIR}/scratch`;

export const PROJECT_TYPES = ["paper", "patent", "both"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export interface ProjectCard {
	/** Absolute path of 2PI.md when it exists. */
	path?: string;
	content?: string;
	type?: ProjectType;
	/** Online literature/patent search is allowed only when the card says so. */
	onlineSearch: boolean;
}

const TYPE_ALIASES: Record<string, ProjectType> = {
	paper: "paper",
	论文: "paper",
	patent: "patent",
	专利: "patent",
	both: "both",
	两者: "both",
	"论文+专利": "both",
	"paper+patent": "both",
};

function field(content: string, names: string[]): string | undefined {
	for (const name of names) {
		const match = new RegExp(`^\\s*[-*]?\\s*${name}\\s*[:：]\\s*(.*)$`, "im").exec(content);
		const value = match?.[1]?.replace(/[（(].*$/, "").trim();
		if (value) return value;
	}
	return undefined;
}

export function parseProjectCard(content: string): Omit<ProjectCard, "path"> {
	const rawType = field(content, ["类型", "Type"])?.toLowerCase().replace(/\s+/g, "");
	const online = field(content, ["联网检索", "Online search"])?.toLowerCase() ?? "";
	return {
		content,
		type: rawType ? TYPE_ALIASES[rawType] : undefined,
		onlineSearch: /^(允许|allowed|allow|yes|是)$/.test(online),
	};
}

/** research2paper's project file; still read so existing paper workspaces keep working. */
export const LEGACY_PAPER_FILE = "PAPER.md";

/** 2PI.md's Chinese field names, mapped to the English keys PAPER.md uses. */
const FIELD_ALIASES: Record<string, string> = {
	目标期刊: "journal",
	作者须知: "author guidelines",
	文章类型: "article type",
	摘要字数上限: "abstract word limit",
	标题字数上限: "title word limit",
	引用格式: "citation style",
	"latex 模板": "latex template",
	稿件: "manuscript",
	参考文献: "bibliography",
	中文说明: "notes",
	证据账本: "evidence",
	回复信: "response letter",
	材料目录: "materials",
};

/**
 * The "- Key: value" lines of a project file, keys lowercased and aliased to English. Empty values
 * mean "not set"; backticks and a trailing full-width （注释） are dropped.
 */
export function parseFields(text: string): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*[-*]\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/.exec(line);
		if (!match) continue;
		const key = (match[1] ?? "").toLowerCase();
		const value = (match[2] ?? "")
			.replace(/（[^）]*）\s*$/, "")
			.replace(/^`(.*)`$/, "$1")
			.trim();
		if (value) fields[FIELD_ALIASES[key] ?? key] = value;
	}
	return fields;
}

/** Fields from PAPER.md, overridden by 2PI.md. */
export function readProjectFields(cwd: string): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const file of [LEGACY_PAPER_FILE, PROJECT_FILE]) {
		const path = join(cwd, file);
		if (existsSync(path)) Object.assign(fields, parseFields(readFileSync(path, "utf8")));
	}
	return fields;
}

/** The evidence ledger both domains share: the card's 证据账本 field, else notes/evidence.json. */
export function ledgerPath(cwd: string): string {
	const configured = readProjectFields(cwd).evidence;
	return resolve(cwd, configured ?? join("notes", "evidence.json"));
}

export function readProjectCard(cwd: string): ProjectCard {
	const path = join(cwd, PROJECT_FILE);
	if (!existsSync(path)) return { onlineSearch: false };
	return { path, ...parseProjectCard(readFileSync(path, "utf8")) };
}

/** Create the project layout. Existing files are never overwritten. Returns the paths created. */
export function initProject(cwd: string, type: ProjectType): string[] {
	const created: string[] = [];
	const ensureDir = (dir: string) => {
		const path = join(cwd, dir);
		if (!existsSync(path)) {
			mkdirSync(path, { recursive: true });
			created.push(`${dir}/`);
		}
	};
	const ensureFile = (file: string, content: string) => {
		const path = join(cwd, file);
		if (!existsSync(path)) {
			writeFileSync(path, content, "utf8");
			created.push(file);
		}
	};
	const template = readFileSync(join(AGENT_ROOT, "templates", PROJECT_FILE), "utf8");
	ensureFile(PROJECT_FILE, template.replace("{{type}}", type));
	// A patent project that now also gets a paper (or the reverse) becomes "both".
	const card = readProjectCard(cwd);
	if (card.path && card.content && card.type && card.type !== type && card.type !== "both") {
		writeFileSync(card.path, card.content.replace(/^(\s*[-*]?\s*(?:类型|Type)\s*[:：]\s*)\S+/im, "$1both"), "utf8");
		created.push(`${PROJECT_FILE}（类型改为 both）`);
	}
	ensureDir("materials");
	ensureFile(
		"materials/README.md",
		"把论文、方法笔记、实验记录、结果表、图、参考文献、审稿意见放在这里。2pi 只读这个目录，不会修改或删除其中的文件。\n",
	);
	ensureDir("notes");
	if (type !== "paper") ensureDir("patent");
	ensureStateDir(cwd);
	return created;
}

/** `.2pi/` holds agent state; its own .gitignore keeps it out of the user's repository. */
export function ensureStateDir(cwd: string): string {
	const dir = join(cwd, STATE_DIR);
	mkdirSync(dir, { recursive: true });
	const ignore = join(dir, ".gitignore");
	if (!existsSync(ignore)) writeFileSync(ignore, "*\n", "utf8");
	return dir;
}
