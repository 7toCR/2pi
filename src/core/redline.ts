import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Pack } from "../packs/types.ts";
import type { Checkpoints } from "./checkpoints.ts";
import { type ChangeSet, type History, selectChanges } from "./history.ts";
import { slash } from "./paths.ts";
import { STATE_DIR } from "./project.ts";
import { documentDiffs, type FileDiff } from "./review.ts";
import { renderReviewPage } from "./review-html.ts";

/**
 * Redlines for one turn or a range of turns: the HTML review page (always) plus what each pack
 * can produce for its documents (a latexdiff PDF for the paper, a tracked-changes DOCX for the
 * patent). Everything goes to .2pi/review/<label>/.
 */

export interface RedlineContext {
	cwd: string;
	from: string;
	to: string;
	label: string;
	outDir: string;
	diffs: FileDiff[];
	turns: ChangeSet[];
	checkpoints: Checkpoints;
	signal?: AbortSignal;
}

export interface RedlineOutput {
	label: string;
	/** Absolute path of the file; undefined when the output could not be made (see note). */
	path?: string;
	note?: string;
}

export interface RedlineResult {
	label: string;
	page: string;
	outputs: RedlineOutput[];
	changedBlocks: number;
}

export async function makeRedline(
	history: History,
	packs: Pack[],
	spec: string | undefined,
	signal?: AbortSignal,
): Promise<RedlineResult> {
	const turns = selectChanges(history.changes, spec);
	if (turns.length === 0) {
		throw new Error(spec ? `没有找到 ${spec}（格式：c0003 或 c0001..c0003）。` : "还没有记录到修改。");
	}
	const first = turns[0] as ChangeSet;
	const last = turns.at(-1) as ChangeSet;
	const label = turns.length === 1 ? first.id : `${first.id}-${last.id}`;
	const cwd = history.checkpoints.cwd;
	const outDir = join(cwd, STATE_DIR, "review", label);
	mkdirSync(outDir, { recursive: true });
	const diffs = documentDiffs(history.checkpoints, history.extractors, first.before, last.after);
	const context: RedlineContext = { cwd, from: first.before, to: last.after, label, outDir, diffs, turns, checkpoints: history.checkpoints, signal };

	const outputs: RedlineOutput[] = [];
	for (const pack of packs) {
		if (!pack.redline) continue;
		try {
			outputs.push(...(await pack.redline(context)));
		} catch (error) {
			outputs.push({ label: `${pack.id} 修订稿`, note: `未能生成：${error instanceof Error ? error.message : String(error)}` });
		}
	}

	const page = join(outDir, "review.html");
	writeFileSync(
		page,
		renderReviewPage({
			label,
			project: slash(cwd),
			turns,
			files: diffs,
			outputs: outputs.map((output) => ({
				label: output.label,
				href: output.path ? slash(relative(outDir, output.path)) : undefined,
				note: output.note,
			})),
		}),
		"utf8",
	);
	const changedBlocks = diffs.reduce((n, d) => n + d.blocks.filter((b) => b.status !== "unchanged").length, 0);
	return { label, page, outputs, changedBlocks };
}

export function formatRedline(result: RedlineResult, cwd: string): string {
	const rel = (path: string) => slash(relative(cwd, path)) || path;
	return [
		`修订稿 ${result.label}：修改 ${result.changedBlocks} 处。`,
		`审阅页：${rel(result.page)}`,
		...result.outputs.map((o) => `${o.label}：${o.path ? rel(o.path) : ""}${o.note ? `（${o.note}）` : ""}`),
	].join("\n");
}

/** Open a file with the system's default application (the review page in a browser). */
export function openFile(path: string): void {
	const [command, args] =
		process.platform === "win32"
			? ["cmd", ["/c", "start", "", path]]
			: process.platform === "darwin"
				? ["open", [path]]
				: ["xdg-open", [path]];
	try {
		spawn(command, args as string[], { detached: true, stdio: "ignore", windowsHide: true }).unref();
	} catch {
		// No opener: the path is reported to the user anyway.
	}
}
