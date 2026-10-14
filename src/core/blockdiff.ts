import { diffArrays } from "diff";
import type { Block } from "./blocks.ts";

export type BlockStatus = "unchanged" | "added" | "removed" | "modified";

/** One position of the aligned old and new block sequences. */
export interface AlignedBlock {
	status: BlockStatus;
	/** The new block's id and title (the old one's for a removed block). */
	block: string;
	title: string;
	before?: string;
	after?: string;
}

/**
 * Tokens for a word-level diff: each CJK character on its own (Chinese has no spaces), Latin
 * words and numbers whole, whitespace runs and punctuation separately.
 */
export function tokenize(text: string): string[] {
	return text.match(/[㐀-鿿豈-﫿]|[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,]\d+)*|\s+|[^\sA-Za-z\d㐀-鿿豈-﫿]/g) ?? [];
}

function similarity(a: string, b: string): number {
	const ta = new Set(tokenize(a).filter((t) => t.trim()));
	const tb = new Set(tokenize(b).filter((t) => t.trim()));
	if (ta.size === 0 || tb.size === 0) return 0;
	let common = 0;
	for (const t of ta) if (tb.has(t)) common++;
	return common / (ta.size + tb.size - common);
}

/** Below this token overlap a replaced block is shown as removed + added rather than modified. */
const PAIR_THRESHOLD = 0.2;

/**
 * Align two versions of a document block by block. Identical texts anchor the alignment (block
 * ids are positional, so an inserted claim must not mark every later claim as changed); between
 * anchors, removed and added blocks are paired in order when their texts are similar enough.
 */
export function alignBlocks(before: Block[], after: Block[]): AlignedBlock[] {
	const parts = diffArrays(
		before.map((b) => b.text),
		after.map((b) => b.text),
	);
	const out: AlignedBlock[] = [];
	let i = 0;
	let j = 0;
	for (let k = 0; k < parts.length; k++) {
		const part = parts[k];
		if (!part) continue;
		const count = part.count ?? part.value.length;
		if (!part.added && !part.removed) {
			for (let n = 0; n < count; n++, i++, j++) {
				const b = after[j] as Block;
				out.push({ status: "unchanged", block: b.id, title: b.title, before: before[i]?.text, after: b.text });
			}
			continue;
		}
		// A removed run followed by an added run: pair them up where similar.
		const removed = part.removed ? before.slice(i, i + count) : [];
		const next = part.removed ? parts[k + 1] : undefined;
		const addedCount = part.added ? count : next?.added ? (next.count ?? next.value.length) : 0;
		const added = part.added ? after.slice(j, j + count) : after.slice(j, j + addedCount);
		if (part.removed && next?.added) k++;
		i += removed.length;
		j += added.length;
		let r = 0;
		let a = 0;
		while (r < removed.length || a < added.length) {
			const old = removed[r];
			const fresh = added[a];
			if (old && fresh && similarity(old.text, fresh.text) >= PAIR_THRESHOLD) {
				out.push({ status: "modified", block: fresh.id, title: fresh.title, before: old.text, after: fresh.text });
				r++;
				a++;
			} else if (old && (!fresh || removed.length - r >= added.length - a)) {
				out.push({ status: "removed", block: old.id, title: old.title, before: old.text });
				r++;
			} else if (fresh) {
				out.push({ status: "added", block: fresh.id, title: fresh.title, after: fresh.text });
				a++;
			}
		}
	}
	return out;
}

export interface Segment {
	op: "=" | "+" | "-";
	text: string;
}

/** The segments of one aligned block, for renderers that mark insertions and deletions. */
export function blockSegments(block: AlignedBlock): Segment[] {
	if (block.status === "unchanged") return [{ op: "=", text: block.after ?? "" }];
	if (block.status === "added") return [{ op: "+", text: block.after ?? "" }];
	if (block.status === "removed") return [{ op: "-", text: block.before ?? "" }];
	return wordDiff(block.before ?? "", block.after ?? "");
}

/** Word-level (character-level for Chinese) differences between two texts. */
export function wordDiff(before: string, after: string): Segment[] {
	const a = tokenize(before);
	const b = tokenize(after);
	// The diff is quadratic in the worst case; very long rewrites are shown as replaced wholesale.
	if (a.length * b.length > 4_000_000) {
		return [
			{ op: "-", text: before },
			{ op: "+", text: after },
		];
	}
	const segments: Segment[] = [];
	for (const part of diffArrays(a, b)) {
		const op = part.added ? "+" : part.removed ? "-" : "=";
		const text = part.value.join("");
		const last = segments.at(-1);
		if (last && last.op === op) last.text += text;
		else segments.push({ op, text });
	}
	return cleanupSemantic(segments);
}

type Run = { same: string } | { del: string; ins: string };

/**
 * Fold short unchanged stretches between two edits into the edits ("[-was designed to reduce-]
 * {+aimed to limit+}" instead of "[-was-]{+aimed+} [-designed -]to [-reduce-]{+limit+}"). As in
 * diff-match-patch's semantic cleanup, a stretch is folded when it is no longer than the edits on
 * either side of it. Unchanged text at the start and end of a block is never folded.
 */
function cleanupSemantic(segments: Segment[]): Segment[] {
	const runs: Run[] = [];
	for (const segment of segments) {
		const last = runs.at(-1);
		if (segment.op === "=") runs.push({ same: segment.text });
		else if (last && "del" in last) segment.op === "-" ? (last.del += segment.text) : (last.ins += segment.text);
		else runs.push(segment.op === "-" ? { del: segment.text, ins: "" } : { del: "", ins: segment.text });
	}
	const size = (run: Run | undefined) => (run && "del" in run ? Math.max(run.del.length, run.ins.length) : -1);
	let changed = true;
	while (changed) {
		changed = false;
		for (let i = 1; i < runs.length - 1; i++) {
			const run = runs[i];
			const before = runs[i - 1];
			const after = runs[i + 1];
			if (!run || !("same" in run) || !before || !after || !("del" in before) || !("del" in after)) continue;
			if (run.same.length > size(before) || run.same.length > size(after)) continue;
			runs.splice(i - 1, 3, { del: before.del + run.same + after.del, ins: before.ins + run.same + after.ins });
			changed = true;
			break;
		}
	}
	return runs.flatMap((run): Segment[] =>
		"same" in run
			? [{ op: "=", text: run.same }]
			: [
					...(run.del ? [{ op: "-" as const, text: run.del }] : []),
					...(run.ins ? [{ op: "+" as const, text: run.ins }] : []),
				],
	);
}
