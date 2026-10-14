import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizePath } from "../../core/paths.ts";
import type { GateReport } from "../types.ts";
import { checkFile } from "./checker.ts";
import { latexProjectOf, loadPaperConfig } from "./config.ts";
import { compileProject } from "./latex.ts";
import type { PaperState } from "./state.ts";

/** Files the checker should run on: the main .tex for anything in the LaTeX project or the notes, else the file itself. */
export function checkTargets(state: PaperState, cwd: string): string[] {
	const config = loadPaperConfig(cwd);
	const manuscript = config.manuscript && existsSync(config.manuscript) ? config.manuscript : undefined;
	const isNotes = (file: string) => !!config.notes && normalizePath(file) === normalizePath(config.notes);
	const targets = new Map<string, string>();
	for (const file of state.unchecked.values()) {
		if (manuscript && (isNotes(file) || latexProjectOf(config, file))) targets.set(normalizePath(manuscript), manuscript);
		else if (!isNotes(file) && !file.endsWith(".bib") && existsSync(file)) targets.set(normalizePath(file), file);
	}
	return [...targets.values()];
}

/**
 * End-of-turn check: compile and check whatever manuscript files changed since their last
 * compile/check. The core gate decides whether errors start a fix round.
 */
export async function paperAutoCheck(
	checkerScript: string,
	state: PaperState,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<GateReport | undefined> {
	const config = loadPaperConfig(cwd);
	const project = config.manuscript?.endsWith(".tex") ? dirname(config.manuscript) : undefined;
	const compile = project !== undefined && state.uncompiled.has(normalizePath(project));
	const targets = checkTargets(state, cwd);
	if (!compile && targets.length === 0) {
		state.unchecked.clear();
		return undefined;
	}

	const parts: string[] = [];
	let needsFix = false;
	if (compile) {
		try {
			const outcome = await compileProject(state, cwd, config.manuscript, { signal });
			parts.push(outcome.text);
			needsFix ||= outcome.needsFix;
		} catch (error) {
			parts.push(`Compilation could not run: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	for (const target of targets) {
		try {
			const outcome = await checkFile(checkerScript, state, cwd, { path: target }, signal);
			parts.push(outcome.text);
			needsFix ||= outcome.report.errors > 0;
		} catch (error) {
			state.markChecked(resolve(target));
			parts.push(`Check of ${target} could not run: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { text: ["论文：本轮修改后的自动编译与检查", ...parts].join("\n\n"), needsFix };
}
