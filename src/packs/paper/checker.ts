import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isInside } from "../../core/paths.ts";
import { STATE_DIR } from "../../core/project.ts";
import { runPython } from "../../core/python.ts";
import { latexProjectOf, loadPaperConfig } from "./config.ts";
import type { PaperState } from "./state.ts";

export type CheckMode = "auto" | "manuscript" | "section" | "response";

export interface CheckFinding {
	level: "ERROR" | "WARN" | "INFO";
	code: string;
	where: string;
	message: string;
}

export interface CheckReport {
	path: string;
	format: string;
	mode: string;
	errors: number;
	warnings: number;
	findings: CheckFinding[];
}

export interface CheckOptions {
	script: string;
	input: string;
	bib?: string;
	notes?: string;
	/** Evidence ledger JSON (--ledger): untraced numbers are reported as V01. */
	ledger?: string;
	mode?: CheckMode;
	final?: boolean;
	abstractWords?: number;
	titleWords?: number;
	/** Directory for the JSON report; a temp directory when omitted. */
	reportDir?: string;
	cwd: string;
	signal?: AbortSignal;
}

export async function runChecker(options: CheckOptions): Promise<{ report: CheckReport; reportPath: string }> {
	const reportDir = options.reportDir ?? join(tmpdir(), "2pi-reports");
	mkdirSync(reportDir, { recursive: true });
	const reportPath = join(reportDir, `check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);

	const args = [options.input, "--json", reportPath];
	if (options.mode && options.mode !== "auto") args.push("--mode", options.mode);
	if (options.bib) args.push("--bib", options.bib);
	if (options.notes) args.push("--notes", options.notes);
	if (options.ledger) args.push("--ledger", options.ledger);
	if (options.abstractWords) args.push("--abstract-words", String(options.abstractWords));
	if (options.titleWords) args.push("--title-words", String(options.titleWords));
	if (options.final) args.push("--final");

	const result = await runPython(options.script, args, { cwd: options.cwd, signal: options.signal, timeoutMs: 120_000 });
	// Exit 0 = clean, 1 = ERROR findings; anything else (2 = missing input) is a failed run.
	if (result.code !== 0 && result.code !== 1) {
		throw new Error(`check_paper_draft.py failed (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`);
	}
	let report: CheckReport;
	try {
		report = JSON.parse(readFileSync(reportPath, "utf8")) as CheckReport;
	} catch {
		throw new Error(`check_paper_draft.py wrote no JSON report.\n${(result.stderr || result.stdout).trim()}`);
	}
	return { report, reportPath };
}

const LEVEL_ORDER = { ERROR: 0, WARN: 1, INFO: 2 } as const;
const MAX_ROWS = 60;

/** Model-facing summary: every ERROR, then WARNs, capped; INFO only as a count. */
export function formatReport(report: CheckReport, reportPath: string, final: boolean): string {
	const rows = report.findings
		.filter((f) => f.level !== "INFO")
		.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.code.localeCompare(b.code));
	const info = report.findings.length - rows.length;
	const lines = [
		`check_paper_draft: ${report.path} (${report.format}, ${report.mode} mode${final ? ", final" : ""})`,
		`Summary: ${report.errors} error(s), ${report.warnings} warning(s), ${info} info.`,
	];
	for (const f of rows.slice(0, MAX_ROWS)) lines.push(`${f.level} ${f.code} ${f.where}: ${f.message}`);
	if (rows.length > MAX_ROWS) lines.push(`... ${rows.length - MAX_ROWS} more; full report: ${reportPath}`);
	if (report.errors > 0) {
		lines.push("Fix every ERROR, then run check_draft again.");
	} else if (report.warnings > 0) {
		lines.push("No ERROR. For each WARN, fix it or state in the notes why it is a false alarm.");
	} else {
		lines.push("No ERROR or WARN. The checker cannot judge whether claims are true; apply the quality checklist.");
	}
	return lines.join("\n");
}

export interface CheckRequest {
	path: string;
	bib?: string;
	notes?: string;
	/** Evidence ledger; default: the project ledger when it exists. false disables the comparison. */
	ledger?: string | false;
	mode?: CheckMode;
	final?: boolean;
}

export interface CheckOutcome {
	report: CheckReport;
	reportPath: string;
	text: string;
	path: string;
	final: boolean;
}

/** Check one draft with the project card's defaults (notes, ledger, word limits) and record the result. */
export async function checkFile(
	script: string,
	state: PaperState,
	cwd: string,
	request: CheckRequest,
	signal?: AbortSignal,
): Promise<CheckOutcome> {
	const config = loadPaperConfig(cwd);
	const path = resolve(cwd, request.path);
	const isManuscript = !!config.manuscript && resolve(config.manuscript) === path;
	const existing = (p: string | undefined) => (p && existsSync(p) ? p : undefined);
	// A .tex manuscript finds its .bib through \bibliography; pass one only when asked.
	const bib = request.bib ? resolve(cwd, request.bib) : undefined;
	const notes = request.notes ? resolve(cwd, request.notes) : isManuscript ? existing(config.notes) : undefined;
	const ledger =
		request.ledger === false ? undefined : request.ledger ? resolve(cwd, request.ledger) : existing(config.evidence);
	const final = request.final ?? false;
	const { report, reportPath } = await runChecker({
		script,
		input: path,
		bib,
		notes,
		ledger,
		mode: request.mode,
		final,
		abstractWords: isManuscript ? config.abstractWords : undefined,
		titleWords: isManuscript ? config.titleWords : undefined,
		reportDir: existsSync(join(cwd, STATE_DIR)) ? join(cwd, STATE_DIR, "reports") : undefined,
		cwd,
		signal,
	});
	state.lastCheck = { path, errors: report.errors, warnings: report.warnings, final, at: new Date().toISOString() };
	state.markChecked(path);
	if (notes) state.markChecked(notes);
	if (bib) state.markChecked(bib);
	// Checking the main .tex reads every included file and the bibliography.
	const project = latexProjectOf(config, path);
	if (project && isManuscript) {
		for (const file of [...state.unchecked.values()]) if (isInside(file, project)) state.markChecked(file);
	}
	return { report, reportPath, text: formatReport(report, reportPath, final), path, final };
}
