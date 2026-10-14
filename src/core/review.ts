import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AlignedBlock, alignBlocks } from "./blockdiff.ts";
import { type BlockExtractor, blockSplitter } from "./blocks.ts";
import type { Checkpoints, FileChange } from "./checkpoints.ts";

/**
 * Block-level differences between two checkpoints (or a checkpoint and the work tree). This is
 * what every change view renders: the TUI viewer, the HTML review page and the redline documents.
 */

export interface FileDiff {
	path: string;
	status: FileChange["status"];
	/** Not compared block by block: binary, oversized, or a format no block splitter handles. */
	binary: boolean;
	/** The whole aligned document, unchanged blocks included; empty for files not compared. */
	blocks: AlignedBlock[];
}

/** A changed block as stored in a change set. */
export interface BlockChange {
	file: string;
	block: string;
	title: string;
	op: "added" | "removed" | "modified";
	before?: string;
	after?: string;
	/** Why the model made the change, from report_changes. */
	why?: string;
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_STORED_CHARS = 6000;

function decode(buffer: Buffer | undefined): string {
	return buffer ? buffer.toString("utf8").replace(/^﻿/, "") : "";
}

/** `to` undefined means the current work tree. */
export function documentDiffs(
	checkpoints: Checkpoints,
	extractors: BlockExtractor[],
	from: string,
	to: string | undefined,
	files: FileChange[] = to ? checkpoints.diff(from, to) : checkpoints.diffToWorktree(from),
): FileDiff[] {
	return files.map((file) => {
		const afterBuffer =
			file.status === "deleted"
				? undefined
				: to
					? checkpoints.readAt(to, file.path)
					: existsSync(join(checkpoints.cwd, file.path))
						? readFileSync(join(checkpoints.cwd, file.path))
						: undefined;
		const beforeBuffer = file.status === "added" ? undefined : checkpoints.readAt(from, file.path);
		const tooBig = (afterBuffer?.length ?? 0) > MAX_TEXT_BYTES || (beforeBuffer?.length ?? 0) > MAX_TEXT_BYTES;
		const notCompared = { path: file.path, status: file.status, binary: true, blocks: [] };
		if (file.binary || tooBig) return notCompared;
		const before = decode(beforeBuffer);
		const after = decode(afterBuffer);
		const split = blockSplitter(file.path, after, extractors) ?? blockSplitter(file.path, before, extractors);
		if (!split) return notCompared;
		return { path: file.path, status: file.status, binary: false, blocks: alignBlocks(split(before), split(after)) };
	});
}

const clip = (text: string | undefined) =>
	text === undefined || text.length <= MAX_STORED_CHARS ? text : `${text.slice(0, MAX_STORED_CHARS)}…`;

export function blockChanges(diffs: FileDiff[]): BlockChange[] {
	return diffs.flatMap((diff) =>
		diff.blocks
			.filter((block) => block.status !== "unchanged")
			.map((block) => ({
				file: diff.path,
				block: block.block,
				title: block.title,
				op: block.status as BlockChange["op"],
				before: clip(block.before),
				after: clip(block.after),
			})),
	);
}

export interface Reason {
	/** What changed, in the model's words: a block title ("权利要求1"), an id ("claims/1") or a file. */
	target: string;
	why: string;
}

const norm = (text: string) => text.toLowerCase().replace(/[\s·:：/\\_\-—,，.。()（）]+/g, "");

/**
 * Attach reasons to the blocks they name. A target can name a block (its title or id, with or
 * without the file; a shortened title such as "具体实施方式 第3段" when nothing matches exactly),
 * a section (a title prefix such as "说明书·发明内容" or "权利要求"), or a file. The narrowest
 * reason wins: a block's own reason replaces its section's, and a section's replaces its file's,
 * so a model can give one reason for a whole file and refine single blocks. "权利要求1" never
 * lands on "支持关系·权利要求1" because exact names are tried first. Unmatched reasons are
 * returned so they can be shown as turn-level notes rather than lost.
 */
export function attachReasons(changes: BlockChange[], reasons: Reason[]): { changes: BlockChange[]; unmatched: Reason[] } {
	const unmatched: Reason[] = [];
	// Reasons per change at each level: block, section, file.
	const levels = changes.map((): [string[], string[], string[]] => [[], [], []]);
	const keys = (change: BlockChange) => {
		const name = change.file.split("/").pop() ?? change.file;
		return [change.title, change.block, ...[change.file, name].flatMap((file) => [`${file}${change.title}`, `${file}${change.block}`])].map(norm);
	};
	const isFile = (change: BlockChange, target: string) =>
		target === norm(change.file) || target === norm(change.file.split("/").pop() ?? "");
	const where = (test: (change: BlockChange) => boolean) => changes.flatMap((change, i) => (test(change) ? [i] : []));
	for (const reason of reasons) {
		const target = norm(reason.target);
		if (!target) continue;
		let level = 0;
		let hits = where((change) => keys(change).includes(target));
		if (hits.length === 0 && target.length >= 3) {
			hits = where((change) => !isFile(change, target) && keys(change).some((key) => key.endsWith(target)));
		}
		if (hits.length === 0 && target.length >= 2) {
			level = 1;
			// "权利要求1" is not a section of "权利要求10".
			const section = (key: string) => key.startsWith(target) && !/\d/.test(key.charAt(target.length));
			hits = where((change) => !isFile(change, target) && keys(change).some(section));
		}
		if (hits.length === 0) {
			level = 2;
			hits = where((change) => isFile(change, target));
		}
		if (hits.length === 0) unmatched.push(reason);
		for (const i of hits) levels[i]?.[level]?.push(reason.why);
	}
	const result = changes.map((change, i) => {
		const why = levels[i]?.find((list) => list.length > 0) ?? [];
		const { why: _previous, ...rest } = change;
		return why.length > 0 ? { ...rest, why: why.join("；") } : rest;
	});
	return { changes: result, unmatched };
}

const OP_LABEL = { added: "新增", removed: "删除", modified: "修改" } as const;

/** One line per changed block, for tool results and notifications. */
export function describeBlockChanges(changes: BlockChange[], limit = 30): string[] {
	const lines = changes.slice(0, limit).map((change) => `- ${change.file} · ${change.title}（${OP_LABEL[change.op]}）${change.why ? `：${change.why}` : ""}`);
	if (changes.length > limit) lines.push(`… 共 ${changes.length} 处`);
	return lines;
}

/** A short summary for widgets: titles grouped per file. */
export function summarizeBlockChanges(changes: BlockChange[], maxTitles = 6): string {
	const byFile = new Map<string, string[]>();
	for (const change of changes) {
		const titles = byFile.get(change.file) ?? [];
		titles.push(change.title);
		byFile.set(change.file, titles);
	}
	const parts: string[] = [];
	let shown = 0;
	for (const [file, titles] of byFile) {
		if (shown >= maxTitles) break;
		const room = Math.max(1, maxTitles - shown);
		const list = titles.slice(0, room).join("、") + (titles.length > room ? ` 等 ${titles.length} 处` : "");
		parts.push(`${file.split("/").pop()}：${list}`);
		shown += Math.min(titles.length, room);
	}
	if (byFile.size > parts.length) parts.push(`另有 ${byFile.size - parts.length} 个文件`);
	return parts.join("；");
}
