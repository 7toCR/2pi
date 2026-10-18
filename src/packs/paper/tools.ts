import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { isInside, slash } from "../../core/paths.ts";
import { STATE_DIR } from "../../core/project.ts";
import { runPython } from "../../core/python.ts";
import type { SkillKnowledge } from "../../core/skill.ts";
import { currentFetch } from "../../core/online.ts";
import { checkEntries, type FetchLike, formatBibResults, parseBib } from "./bib.ts";
import { type CheckReport, checkFile } from "./checker.ts";
import { type InitResult, initPaperWorkspace, LATEX_TEMPLATES, LAYOUT, loadPaperConfig } from "./config.ts";
import { compileProject } from "./latex.ts";
import type { PaperState } from "./state.ts";

/**
 * The paper pack's tools, ported from research2paper. Descriptions stay in English: the skill and
 * the manuscripts are English, and these texts were tuned in research2paper's real-model runs.
 */

export interface CheckDraftDetails {
	path: string;
	reportPath: string;
	final: boolean;
	errors: number;
	warnings: number;
	findings: CheckReport["findings"];
}

export function createCheckDraftTool(skill: SkillKnowledge, state: PaperState) {
	const script = join(skill.scriptsDir, "check_paper_draft.py");
	return defineTool({
		name: "check_draft",
		label: "Check draft",
		description:
			"Run the Research2Paper checker (check_paper_draft.py) on a manuscript, section or reviewer-response letter (.md, .tex including its \\input files, .docx, .txt). Reports gap markers, figure/table/equation cross-references, citations against the reference list or .bib, acronyms, unsupported claim wording, percentage-point errors, Abstract/Conclusion numbers missing from the body, audit-log text inside the paper, and response-letter completion claims. For the manuscript named in 2PI.md, the notes file and the word limits written in 2PI.md are applied (there is no other way to set a limit); when the project has an evidence ledger, numbers not recorded in it are reported as V01. It cannot judge whether a claim is true.",
		promptSnippet: "Run the Research2Paper draft checker on a manuscript or response letter",
		promptGuidelines: [
			"Run check_draft on every manuscript or response-letter file you write or revise, before reporting to the user; for a LaTeX paper check the main .tex file, which includes the section files.",
			"Use check_draft with final=true only for a pre-submission check: every remaining [MISSING: ...] marker is then an ERROR.",
			"Word limits are read from 2PI.md (摘要字数上限, 标题字数上限) for the manuscript it names. When the user or the journal's guidelines give a limit, write it into 2PI.md; never invent one.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "Draft or response letter to check, relative to the working directory" }),
			bib: Type.Optional(Type.String({ description: "BibTeX file, when \\bibliography in the .tex does not name it" })),
			notes: Type.Optional(
				Type.String({ description: "Separate file with the Chinese gap notes, when they are not in the draft" }),
			),
			ledger: Type.Optional(
				Type.String({ description: "Evidence ledger JSON; default: the project ledger (notes/evidence.json) when it exists" }),
			),
			mode: Type.Optional(
				Type.Union([Type.Literal("auto"), Type.Literal("manuscript"), Type.Literal("section"), Type.Literal("response")], {
					description: "auto (default) detects a full manuscript, a single section or a response letter",
				}),
			),
			final: Type.Optional(Type.Boolean({ description: "Submission stage: any remaining gap marker is an ERROR" })),
			// No word-limit parameters: models with strict tool schemas filled them with invented limits
			// (seen in research2paper's real runs). Limits come from the project card, where their source is visible.
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const outcome = await checkFile(script, state, ctx.cwd, params, signal);
			return {
				content: [{ type: "text", text: outcome.text }],
				details: {
					path: outcome.path,
					reportPath: outcome.reportPath,
					final: outcome.final,
					errors: outcome.report.errors,
					warnings: outcome.report.warnings,
					findings: outcome.report.findings,
				} satisfies CheckDraftDetails,
			};
		},
	});
}

export function createLatexCompileTool(state: PaperState) {
	return defineTool({
		name: "latex_compile",
		label: "Compile LaTeX",
		description:
			"Compile a LaTeX manuscript to PDF with tectonic (preferred) or latexmk, shell escape disabled, output in build/ next to the main file. Returns errors with file and line, undefined references and citations, duplicate labels, missing files, overfull-box count, page count and the log path. Without a path it compiles the manuscript named in 2PI.md (default paper/main.tex).",
		promptSnippet: "Compile the LaTeX manuscript to PDF and report errors, undefined references and citations",
		promptGuidelines: [
			"After changing LaTeX sources, make sure latex_compile succeeds without undefined references or citations before reporting; fix errors in the source, never by deleting content the paper needs.",
		],
		parameters: Type.Object({
			main: Type.Optional(Type.String({ description: "Main .tex file; default: the manuscript in 2PI.md" })),
			engine: Type.Optional(
				Type.Union([Type.Literal("tectonic"), Type.Literal("latexmk")], {
					description: "Force an engine; default: tectonic when installed, else latexmk",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const outcome = await compileProject(state, ctx.cwd, params.main, { engine: params.engine, signal });
			return {
				content: [{ type: "text", text: outcome.text }],
				details: outcome.result,
				isError: outcome.result ? !outcome.result.ok : true,
			};
		},
	});
}

export function formatPaperInit(result: InitResult): string {
	const lines = [`Created: ${result.created.join(", ") || "nothing"}.`];
	if (result.skipped.length) lines.push(`Kept existing (not overwritten): ${result.skipped.join(", ")}.`);
	lines.push(
		`Layout: author material in ${LAYOUT.materials}/ (read-only), manuscript ${LAYOUT.manuscript} with sections/*.tex and ${LAYOUT.bibliography}, figures in ${LAYOUT.paper}/figures/, Chinese notes in ${LAYOUT.notes}, evidence ledger in ${LAYOUT.evidence}, PDF in ${LAYOUT.paper}/build/.`,
	);
	return lines.join("\n");
}

export const paperInitTool = defineTool({
	name: "paper_init",
	label: "Create paper workspace",
	description:
		"Create the paper part of the project in the working directory: 2PI.md (when missing), materials/ for the author's files, a LaTeX skeleton (paper/main.tex, paper/sections/*.tex, paper/refs.bib, paper/figures/), notes/memo.md for the Chinese notes and the evidence ledger notes/evidence.json. Existing files are never overwritten. Templates: article (generic), elsarticle (Elsevier), ieeetran (IEEE). Use it when the user starts a new paper and there is no paper/main.tex; for a publisher-specific template the user supplies, start from article and adapt.",
	promptSnippet: "Create the paper workspace and LaTeX skeleton (article, elsarticle or ieeetran)",
	parameters: Type.Object({
		template: Type.Optional(
			Type.Union([Type.Literal("article"), Type.Literal("elsarticle"), Type.Literal("ieeetran")], {
				description: "LaTeX skeleton; default article",
			}),
		),
		journal: Type.Optional(Type.String({ description: "Target journal, recorded in 2PI.md" })),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const result = initPaperWorkspace(ctx.cwd, params.template ?? "article", params.journal);
		return { content: [{ type: "text", text: formatPaperInit(result) }], details: result };
	},
});

function texFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (name === "build") continue;
		if (statSync(path).isDirectory()) out.push(...texFiles(path));
		else if (name.endsWith(".tex")) out.push(path);
	}
	return out;
}

export function createFillGapsTool(skill: SkillKnowledge, state: PaperState, paperAreas: (cwd: string) => string[]) {
	const script = join(skill.scriptsDir, "fill_gaps.py");
	return defineTool({
		name: "fill_gaps",
		label: "Fill gaps",
		description:
			"Replace [MISSING: ...] markers with information the author supplied, using the skill's fill_gaps.py: exact marker matching, and lines in the 材料缺口 notes that quote a filled marker are removed. Default files: every .tex file of the LaTeX manuscript plus the notes file, edited in place (they are the agent's working drafts). Other files get a <name>.filled<ext> copy unless inPlace is true.",
		promptSnippet: "Fill [MISSING: ...] markers with author-supplied values across the manuscript and notes",
		promptGuidelines: [
			"Use fill_gaps only with values the author actually supplied; afterwards re-read every sentence that contains a new value and anything that depends on it (Abstract numbers, captions, Limitations).",
		],
		parameters: Type.Object({
			values: Type.Record(Type.String(), Type.String(), {
				description: 'Map from marker (full "[MISSING: ...]" or its inner text) to the author-supplied value',
			}),
			files: Type.Optional(Type.Array(Type.String(), { description: "Files to fill; default: manuscript .tex files and notes" })),
			inPlace: Type.Optional(Type.Boolean({ description: "Overwrite files outside the paper project (only when the author agreed)" })),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const config = loadPaperConfig(ctx.cwd);
			let files = (params.files ?? []).map((f) => resolve(ctx.cwd, f));
			if (files.length === 0) {
				if (config.manuscript?.endsWith(".tex") && existsSync(config.manuscript)) {
					files = texFiles(dirname(config.manuscript));
				} else if (config.manuscript && existsSync(config.manuscript)) {
					files = [config.manuscript];
				}
				if (config.notes && existsSync(config.notes)) files.push(config.notes);
			}
			if (files.length === 0) throw new Error("No files to fill: pass files, or set 稿件 in 2PI.md.");

			const workAreas = paperAreas(ctx.cwd);
			// The notes file only loses lines of markers that really occur in the manuscript files,
			// so a mistyped marker cannot erase a gap from the notes.
			const notesFile = config.notes && files.includes(config.notes) ? config.notes : undefined;
			const body = files
				.filter((f) => f !== notesFile && existsSync(f))
				.map((f) => readFileSync(f, "utf8"))
				.join("\n");
			const occurs = (marker: string) => {
				const inner = marker.replace(/^\[MISSING\s*[:：]\s*/i, "").replace(/\]$/, "").replace(/\s+/g, " ").trim();
				return [...body.matchAll(/\[MISSING\s*[:：]\s*([^\]]*)\]/gi)].some((m) => (m[1] ?? "").replace(/\s+/g, " ").trim() === inner);
			};
			const notesValues = Object.fromEntries(Object.entries(params.values).filter(([marker]) => occurs(marker)));

			const tmp = mkdtempSync(join(tmpdir(), "2pi-fill-"));
			const valuesFile = join(tmp, "values.json");
			const notesValuesFile = join(tmp, "notes-values.json");
			writeFileSync(valuesFile, JSON.stringify(params.values));
			writeFileSync(notesValuesFile, JSON.stringify(notesValues));
			const report: string[] = [];
			try {
				for (const file of files) {
					if (!existsSync(file)) {
						report.push(`${slash(relative(ctx.cwd, file))}: not found`);
						continue;
					}
					const inPlace = params.inPlace || workAreas.some((dir) => isInside(file, dir));
					const values = file === notesFile ? notesValuesFile : valuesFile;
					const args = [file, values, ...(inPlace ? ["--in-place"] : [])];
					const result = await runPython(script, args, { cwd: ctx.cwd, signal });
					if (result.code !== 0) throw new Error(`fill_gaps.py failed on ${file}: ${result.stderr || result.stdout}`);
					const first = result.stdout.split(/\r?\n/)[0] ?? "";
					report.push(`${slash(relative(ctx.cwd, file))}: ${first}`);
					const filledMatch = first.match(/-> (.+)$/);
					const output = filledMatch ? resolve(ctx.cwd, (filledMatch[1] ?? "").trim()) : file;
					const inProject = config.manuscript ? isInside(output, dirname(config.manuscript)) : false;
					state.markUnchecked(inProject && config.manuscript ? config.manuscript : output);
					if (config.manuscript?.endsWith(".tex") && inProject) state.markUncompiled(dirname(config.manuscript));
				}
			} finally {
				rmSync(tmp, { recursive: true, force: true });
			}
			report.push(
				"Markers that matched no value stay open. Re-read each filled sentence and what depends on it; the end-of-turn check will run on the manuscript.",
			);
			return { content: [{ type: "text", text: report.join("\n") }], details: { files } };
		},
	});
}

const MAX_BIB_ENTRIES = 60;

/** fetchFn is injectable for tests; the default is the global fetch, which pi routes through its proxy settings. */
export function createBibLookupTool(fetchFn?: FetchLike) {
	return defineTool({
		name: "bib_lookup",
		label: "Check bibliography",
		description:
			"Check .bib entries against Crossref, and against DataCite for DOIs Crossref does not register (arXiv's 10.48550/arXiv.*, Zenodo, figshare): for an entry with a DOI or an arXiv eprint, whether it is registered and whether title, year and first author match the record; for an entry without either, list close Crossref records from about the same year as leads. Read-only: it never edits the .bib. A matching record does not show that the work supports the sentence citing it. Sends only the cited works' DOI, eprint, title, first author and year to api.crossref.org and api.datacite.org, never the manuscript.",
		promptSnippet: "Check .bib entries against Crossref/DataCite records (DOI exists, title/year/first author match)",
		promptGuidelines: [
			"Use bib_lookup before delivery when the paper has references; put every difference, unregistered DOI, entry without DOI and failed lookup under 待核验事项. Never add a reference, or a DOI from the possible records, that the author has not confirmed.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			bib: Type.Optional(Type.String({ description: "BibTeX file; default: the bibliography in 2PI.md (paper/refs.bib)" })),
			keys: Type.Optional(Type.Array(Type.String(), { description: "Only these citation keys; default: all entries" })),
			search: Type.Optional(
				Type.Boolean({ description: "Search Crossref by title for entries without a DOI; default true" }),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = params.bib ? resolve(ctx.cwd, params.bib) : loadPaperConfig(ctx.cwd).bibliography;
			if (!path || !existsSync(path)) {
				throw new Error("No .bib file: pass bib, or set 参考文献 in 2PI.md.");
			}
			let entries = parseBib(readFileSync(path, "utf8"));
			if (params.keys?.length) {
				const unknown = params.keys.filter((k) => !entries.some((e) => e.key === k));
				if (unknown.length) throw new Error(`Not in ${params.bib ?? "the .bib"}: ${unknown.join(", ")}.`);
				entries = entries.filter((e) => params.keys?.includes(e.key));
			}
			if (entries.length === 0) {
				return { content: [{ type: "text", text: "The .bib file has no entries to check." }], details: { results: [] } };
			}
			const skipped = entries.length > MAX_BIB_ENTRIES ? entries.length - MAX_BIB_ENTRIES : 0;
			const results = await checkEntries(entries.slice(0, MAX_BIB_ENTRIES), {
				fetchFn: fetchFn ?? currentFetch(),
				search: params.search ?? true,
				signal,
			});
			let text = formatBibResults(results);
			if (skipped) text += `\n${skipped} more entries were not checked; call again with keys.`;
			if (existsSync(join(ctx.cwd, STATE_DIR))) {
				const dir = join(ctx.cwd, STATE_DIR, "reports");
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, `bib-${Date.now()}.json`), `${JSON.stringify({ bib: path, results }, null, 2)}\n`);
			}
			return { content: [{ type: "text", text }], details: { results } };
		},
	});
}

export { LATEX_TEMPLATES };
