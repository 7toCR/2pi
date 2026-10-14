import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { AGENT_ROOT } from "../../core/config.ts";
import { isInside, slash } from "../../core/paths.ts";
import { initProject, LEGACY_PAPER_FILE, readProjectFields } from "../../core/project.ts";

/** Default layout of a paper project. The project card (or a legacy PAPER.md) can point elsewhere. */
export const LAYOUT = {
	materials: "materials",
	paper: "paper",
	manuscript: "paper/main.tex",
	bibliography: "paper/refs.bib",
	notes: "notes/memo.md",
	evidence: "notes/evidence.json",
} as const;

export const LATEX_TEMPLATES = ["article", "elsarticle", "ieeetran"] as const;
export type LatexTemplate = (typeof LATEX_TEMPLATES)[number];

const TEMPLATES_DIR = join(AGENT_ROOT, "templates", "paper");

/** What the project card says about the paper, resolved to absolute paths. Missing fields stay undefined. */
export interface PaperConfig {
	journal?: string;
	abstractWords?: number;
	titleWords?: number;
	manuscript?: string;
	bibliography?: string;
	notes?: string;
	/** Evidence ledger (JSON); checks pass it to the checker as --ledger when it exists. */
	evidence?: string;
	materials: string;
}

function positiveInt(value: string | undefined): number | undefined {
	const n = value ? Number.parseInt(value, 10) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A configured path is used as given; a default only once the file exists. */
export function loadPaperConfig(cwd: string): PaperConfig {
	const fields = readProjectFields(cwd);
	const path = (value: string | undefined, fallback: string) => {
		const abs = resolve(cwd, value ?? fallback);
		return value || existsSync(abs) ? abs : undefined;
	};
	return {
		journal: fields.journal,
		abstractWords: positiveInt(fields["abstract word limit"]),
		titleWords: positiveInt(fields["title word limit"]),
		manuscript: path(fields.manuscript, LAYOUT.manuscript),
		bibliography: path(fields.bibliography, LAYOUT.bibliography),
		notes: path(fields.notes, LAYOUT.notes),
		evidence: path(fields.evidence, LAYOUT.evidence),
		materials: resolve(cwd, fields.materials ?? LAYOUT.materials),
	};
}

/** The LaTeX project a file belongs to: the folder of the configured .tex manuscript. */
export function latexProjectOf(config: PaperConfig, path: string): string | undefined {
	if (!config.manuscript?.endsWith(".tex")) return undefined;
	const dir = dirname(config.manuscript);
	return isInside(path, dir) ? dir : undefined;
}

export interface InitResult {
	created: string[];
	skipped: string[];
}

function copyTree(from: string, to: string, cwd: string, result: InitResult): void {
	for (const name of readdirSync(from)) {
		const src = join(from, name);
		const dst = join(to, name);
		if (statSync(src).isDirectory()) {
			mkdirSync(dst, { recursive: true });
			copyTree(src, dst, cwd, result);
		} else if (existsSync(dst)) {
			result.skipped.push(slash(relative(cwd, dst)));
		} else {
			copyFileSync(src, dst);
			result.created.push(slash(relative(cwd, dst)));
		}
	}
}

/**
 * Create the paper part of a project without touching anything that exists: the project card
 * (type paper unless one exists), materials/, the LaTeX skeleton for `template`, notes/memo.md,
 * the evidence ledger, and paper/.gitignore for build output.
 */
export function initPaperWorkspace(cwd: string, template: LatexTemplate = "article", journal?: string): InitResult {
	const result: InitResult = { created: initProject(cwd, "paper"), skipped: [] };
	const write = (rel: string, content: string) => {
		const abs = join(cwd, rel);
		if (existsSync(abs)) {
			result.skipped.push(rel);
			return;
		}
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
		result.created.push(rel);
	};
	if (journal || template !== "article") {
		// Record the choices in the card only when it was just created from the template.
		const card = join(cwd, "2PI.md");
		if (result.created.includes("2PI.md")) {
			writeFileSync(
				card,
				readFileSync(card, "utf8")
					.replace("- 目标期刊：", `- 目标期刊：${journal ?? ""}`)
					.replace("- LaTeX 模板：", `- LaTeX 模板：${template}`),
			);
		}
	}
	mkdirSync(join(cwd, LAYOUT.paper, "figures"), { recursive: true });
	copyTree(join(TEMPLATES_DIR, "latex", "common"), join(cwd, LAYOUT.paper), cwd, result);
	copyTree(join(TEMPLATES_DIR, "latex", template), join(cwd, LAYOUT.paper), cwd, result);
	write(LAYOUT.notes, readFileSync(join(TEMPLATES_DIR, "memo.md"), "utf8"));
	write(LAYOUT.evidence, `${JSON.stringify({ version: 1, entries: [] }, null, "\t")}\n`);
	write("paper/.gitignore", "build/\n");
	return result;
}

/** A directory research2paper or 2pi set up for a paper. */
export function isPaperWorkspace(cwd: string): boolean {
	return existsSync(join(cwd, LEGACY_PAPER_FILE)) || existsSync(join(cwd, LAYOUT.manuscript));
}
