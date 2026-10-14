import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { tool } from "../../core/exec.ts";
import { slash as toPosix } from "../../core/paths.ts";
import { countPdfPages } from "../../core/pdf.ts";
import { loadPaperConfig } from "./config.ts";
import type { PaperState } from "./state.ts";

export type Engine = "tectonic" | "latexmk";

export interface EngineInfo {
	engine: Engine;
	command: string;
}

/**
 * Preferred engine: tectonic (single binary, fetches missing packages), else latexmk from an
 * installed TeX distribution. TWOPI_TECTONIC / TWOPI_LATEXMK point at explicit executables.
 */
export function detectEngine(prefer?: Engine): EngineInfo | undefined {
	const tectonic = tool("TECTONIC", "tectonic");
	const latexmk = tool("LATEXMK", "latexmk");
	const found: EngineInfo[] = [];
	if (tectonic) found.push({ engine: "tectonic", command: tectonic });
	if (latexmk) found.push({ engine: "latexmk", command: latexmk });
	return found.find((e) => e.engine === prefer) ?? found[0];
}

export const ENGINE_HELP =
	"No LaTeX engine found. Install tectonic (recommended: one executable, downloads missing packages on first use; see https://tectonic-typesetting.github.io) or a TeX distribution with latexmk (TeX Live, MiKTeX), or set TWOPI_TECTONIC / TWOPI_LATEXMK to the executable.";

export interface LatexIssue {
	file?: string;
	line?: number;
	message: string;
}

export interface CompileResult {
	ok: boolean;
	engine: Engine;
	main: string;
	pdf?: string;
	pages?: number;
	log?: string;
	errors: LatexIssue[];
	undefinedReferences: string[];
	undefinedCitations: string[];
	multiplyDefinedLabels: string[];
	missingFiles: string[];
	overfullBoxes: number;
	notes: string[];
	durationMs: number;
}

export interface CompileOptions {
	main: string;
	engine: EngineInfo;
	/** Output folder relative to the main file's folder. */
	outDir?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}

function run(command: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal) {
	return new Promise<{ code: number; output: string }>((resolve, reject) => {
		execFile(
			command,
			args,
			{ cwd, timeout: timeoutMs, signal, maxBuffer: 32 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
			(error, stdout, stderr) => {
				if (error && typeof error.code !== "number") {
					if ((error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
						resolve({ code: -1, output: `${stdout}${stderr}\nTimed out after ${timeoutMs / 1000} s.` });
					} else {
						reject(error);
					}
					return;
				}
				resolve({ code: typeof error?.code === "number" ? error.code : 0, output: `${stdout}${stderr}` });
			},
		);
	});
}

/** Unicode engines are needed for fontspec / CJK packages; everything else compiles with pdflatex. */
export function needsUnicodeEngine(tex: string): boolean {
	return /\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:fontspec|xeCJK|ctex|unicode-math|polyglossia)\b/.test(tex);
}

export function engineArgs(engine: Engine, mainName: string, outDir: string, unicode: boolean): string[] {
	if (engine === "tectonic") {
		// Tectonic disables shell escape unless -Z shell-escape is given; --untrusted makes that explicit.
		return ["--untrusted", "--keep-logs", "--keep-intermediates", "--chatter", "minimal", "--outdir", outDir, mainName];
	}
	return [
		unicode ? "-xelatex" : "-pdf",
		"-interaction=nonstopmode",
		"-halt-on-error",
		"-file-line-error",
		"-no-shell-escape",
		`-outdir=${outDir}`,
		mainName,
	];
}

const unique = (items: string[]) => [...new Set(items)];

/** Extract what matters from a TeX log (and BibTeX .blg); line-level, no attempt to track the file stack. */
export function parseLatexLog(log: string, blg = "", engineOutput = ""): Omit<CompileResult, "ok" | "engine" | "main" | "durationMs"> {
	const errors: LatexIssue[] = [];
	const lines = log.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fileLine = line.match(/^(?:\.\/|\.\\)?([^\s:]+\.(?:tex|sty|cls|bbl|aux)):(\d+): (.+)$/);
		if (fileLine) {
			errors.push({ file: fileLine[1], line: Number(fileLine[2]), message: fileLine[3].trim() });
			continue;
		}
		if (line.startsWith("! ")) {
			const lineRef = lines.slice(i + 1, i + 12).find((l) => /^l\.\d+/.test(l));
			const no = lineRef?.match(/^l\.(\d+)/)?.[1];
			errors.push({ line: no ? Number(no) : undefined, message: line.slice(2).trim() });
		}
	}
	// Tectonic reports "error: sections/a:2: Undefined control sequence" (no .tex suffix) on stderr,
	// wrapped in generic lines, and the same error again as "! ..." in the log.
	const generic = /something bad happened inside|engine had an unrecoverable error|halted on potentially-recoverable error/i;
	const norm = (message: string) => message.replace(/\.$/, "").trim();
	for (const line of engineOutput.split(/\r?\n/)) {
		const m = line.match(/^error: (?:(.+?):(\d+): )?(.+)$/);
		if (!m || generic.test(m[3])) continue;
		const file = m[1] && !/\.\w+$/.test(m[1]) ? `${m[1]}.tex` : m[1];
		const issue = { file, line: m[2] ? Number(m[2]) : undefined, message: m[3].trim() };
		const same = (e: LatexIssue) => norm(e.message) === norm(issue.message) && (e.line === undefined || e.line === issue.line);
		const index = errors.findIndex((e) => same(e) && !e.file);
		if (index >= 0) errors[index] = issue;
		else if (!errors.some(same)) errors.push(issue);
	}

	const undefinedReferences = unique([...log.matchAll(/Reference `([^']+)' on page \d+ undefined/g)].map((m) => m[1]));
	const undefinedCitations = unique([
		...[...log.matchAll(/Citation `([^']+)' on page \d+ undefined/g)].map((m) => m[1]),
		...[...blg.matchAll(/Warning--I didn't find a database entry for "([^"]+)"/g)].map((m) => m[1]),
	]);
	const multiplyDefinedLabels = unique([...log.matchAll(/Label `([^']+)' multiply defined/g)].map((m) => m[1]));
	const missingFiles = unique([
		...[...log.matchAll(/(?:LaTeX Error: )?File `([^']+)' not found/g)].map((m) => m[1]),
		...[...log.matchAll(/No file ([^\s]+\.(?:bbl|ind|gls))\./g)].map((m) => m[1]).filter((f) => !f.endsWith(".bbl")),
	]);
	const overfullBoxes = [...log.matchAll(/Overfull \\[hv]box \((\d+(?:\.\d+)?)pt too/g)].filter(
		(m) => Number(m[1]) >= 1,
	).length;
	const notes: string[] = [];
	if (/I found no \\citation commands/.test(blg)) notes.push("BibTeX: no \\cite commands yet, so the bibliography is empty.");
	if (/I couldn't open database file/.test(blg)) notes.push("BibTeX: a .bib file named in \\bibliography was not found.");
	const pages = log.match(/Output written on .+? \((\d+) pages?,/)?.[1];
	return {
		errors,
		undefinedReferences,
		undefinedCitations,
		multiplyDefinedLabels,
		missingFiles,
		overfullBoxes,
		notes,
		pages: pages ? Number(pages) : undefined,
	};
}

export async function compileLatex(options: CompileOptions): Promise<CompileResult> {
	const started = Date.now();
	const cwd = dirname(options.main);
	const mainName = basename(options.main);
	const stem = mainName.replace(/\.tex$/i, "");
	const outDir = options.outDir ?? "build";
	const outAbs = join(cwd, outDir);
	mkdirSync(outAbs, { recursive: true });
	const pdfPath = join(outAbs, `${stem}.pdf`);
	const before = existsSync(pdfPath) ? statSync(pdfPath).mtimeMs : 0;

	const unicode = needsUnicodeEngine(readFileSync(options.main, "utf8"));
	const args = engineArgs(options.engine.engine, mainName, outDir, unicode);
	const timeout = options.timeoutMs ?? (options.engine.engine === "tectonic" ? 300_000 : 180_000);
	const { code, output } = await run(options.engine.command, args, cwd, timeout, options.signal);

	const logPath = join(outAbs, `${stem}.log`);
	const log = existsSync(logPath) ? readFileSync(logPath, "latin1") : "";
	const blgPath = join(outAbs, `${stem}.blg`);
	const blg = existsSync(blgPath) ? readFileSync(blgPath, "latin1") : "";
	const parsed = parseLatexLog(log, blg, output);

	const fresh = existsSync(pdfPath) && statSync(pdfPath).mtimeMs > before;
	const ok = code === 0 && fresh && parsed.errors.length === 0;
	if (!ok && parsed.errors.length === 0) {
		if (code === -1) {
			const hint =
				options.engine.engine === "tectonic"
					? " The first tectonic runs download the LaTeX packages a document needs; once they are cached, compiling again is fast."
					: "";
			parsed.errors.push({ message: `${options.engine.engine} timed out after ${timeout / 1000} s.${hint}` });
		} else {
			const tail = output.trim().split(/\r?\n/).slice(-8).join("\n");
			parsed.errors.push({ message: `${options.engine.engine} exited with code ${code}. Output tail:\n${tail}` });
		}
	}
	return {
		ok,
		engine: options.engine.engine,
		main: options.main,
		pdf: fresh ? pdfPath : undefined,
		pages: fresh ? (parsed.pages ?? countPdfPages(readFileSync(pdfPath))) : undefined,
		log: existsSync(logPath) ? logPath : undefined,
		...parsed,
		durationMs: Date.now() - started,
	};
}

const MAX_ITEMS = 20;

function list(items: string[]): string {
	return items.length > MAX_ITEMS
		? `${items.slice(0, MAX_ITEMS).join(", ")} … (+${items.length - MAX_ITEMS})`
		: items.join(", ");
}

/** Model-facing summary of a compile. Paths are shown relative to `cwd`. */
export function formatCompile(result: CompileResult, cwd: string): string {
	const rel = (p: string) => toPosix(relative(cwd, p)) || p;
	const lines = [
		result.ok
			? `Compiled ${rel(result.main)} with ${result.engine}: ${rel(result.pdf ?? "")}${result.pages ? ` (${result.pages} page(s))` : ""}.`
			: `Compilation of ${rel(result.main)} with ${result.engine} FAILED.`,
	];
	for (const e of result.errors.slice(0, MAX_ITEMS)) {
		const at = e.file ? `${toPosix(e.file)}${e.line ? `:${e.line}` : ""}: ` : e.line ? `line ${e.line}: ` : "";
		lines.push(`ERROR ${at}${e.message}`);
	}
	if (result.errors.length > MAX_ITEMS) lines.push(`… ${result.errors.length - MAX_ITEMS} more errors`);
	if (result.missingFiles.length) lines.push(`Missing files: ${list(result.missingFiles)}`);
	if (result.undefinedReferences.length) lines.push(`Undefined references: ${list(result.undefinedReferences)}`);
	if (result.undefinedCitations.length) lines.push(`Undefined citations: ${list(result.undefinedCitations)}`);
	if (result.multiplyDefinedLabels.length) lines.push(`Multiply defined labels: ${list(result.multiplyDefinedLabels)}`);
	if (result.overfullBoxes) lines.push(`Overfull boxes: ${result.overfullBoxes}`);
	lines.push(...result.notes);
	if (result.log) lines.push(`Full log: ${rel(result.log)}`);
	if (!result.ok) {
		lines.push("Fix the errors in the source files and compile again. Never hide an error by deleting content the paper needs.");
	} else if (result.undefinedCitations.length) {
		lines.push(
			"An undefined citation means a \\cite key has no entry in the .bib: add the real, verified entry, or replace the citation with [MISSING: source supporting this statement]. Never invent a record.",
		);
	}
	return lines.join("\n");
}

/** Whether a compile result has problems the agent must fix before delivering. */
export function compileNeedsFix(result: CompileResult): boolean {
	return (
		!result.ok ||
		result.undefinedReferences.length > 0 ||
		result.undefinedCitations.length > 0 ||
		result.multiplyDefinedLabels.length > 0 ||
		result.missingFiles.length > 0
	);
}

export interface CompileOutcome {
	result?: CompileResult;
	text: string;
	needsFix: boolean;
}

/** Compile the project card's manuscript (or `main`) and record the result for <project_state>. */
export async function compileProject(
	state: PaperState,
	cwd: string,
	main: string | undefined,
	options: { engine?: Engine; signal?: AbortSignal } = {},
): Promise<CompileOutcome> {
	const config = loadPaperConfig(cwd);
	const target = main ? resolve(cwd, main) : config.manuscript;
	if (!target || !target.endsWith(".tex")) {
		return { text: "No LaTeX manuscript: pass the main .tex file or set 稿件 in 2PI.md.", needsFix: false };
	}
	if (!existsSync(target)) return { text: `${target} does not exist.`, needsFix: false };
	const engine = detectEngine(options.engine);
	if (!engine) {
		return {
			text: "No LaTeX engine found (tectonic or latexmk). The PDF was not built; tell the user to install tectonic, or set TWOPI_TECTONIC / TWOPI_LATEXMK.",
			needsFix: false,
		};
	}
	const result = await compileLatex({ main: target, engine, signal: options.signal });
	if (options.engine && options.engine !== engine.engine) {
		result.notes.unshift(`${options.engine} is not installed; compiled with ${engine.engine} instead.`);
	}
	const needsFix = compileNeedsFix(result);
	state.lastCompile = {
		main: target,
		ok: result.ok,
		problems:
			result.errors.length +
			result.undefinedReferences.length +
			result.undefinedCitations.length +
			result.multiplyDefinedLabels.length +
			result.missingFiles.length,
		pages: result.pages,
		at: new Date().toISOString(),
	};
	state.markCompiled(dirname(target));
	return { result, text: formatCompile(result, cwd), needsFix };
}