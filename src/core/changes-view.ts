import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { wordDiff } from "./blockdiff.ts";
import { type ChangeSet, describeChange, type History, selectChanges } from "./history.ts";
import type { BlockChange } from "./review.ts";

/**
 * /changes: the list of turns, or one turn's changed blocks with a word-level diff. In the
 * terminal UI it opens a scrollable viewer; elsewhere it prints the same content with
 * [-删除-]{+新增+} markers.
 */

export interface Styler {
	title(text: string): string;
	dim(text: string): string;
	added(text: string): string;
	removed(text: string): string;
	reason(text: string): string;
}

export const PLAIN_STYLE: Styler = {
	title: (text) => text,
	dim: (text) => text,
	added: (text) => `{+${text}+}`,
	removed: (text) => `[-${text}-]`,
	reason: (text) => text,
};

export function themeStyle(theme: Theme): Styler {
	return {
		title: (text) => theme.bold(theme.fg("accent", text)),
		dim: (text) => theme.fg("dim", text),
		added: (text) => theme.underline(theme.fg("toolDiffAdded", text)),
		removed: (text) => theme.strikethrough(theme.fg("toolDiffRemoved", text)),
		reason: (text) => theme.fg("warning", text),
	};
}

const OP_LABEL = { added: "新增", removed: "删除", modified: "修改" } as const;

/** The content of one block change: the whole new or old text, or the word diff. */
function blockBody(change: BlockChange, style: Styler): string {
	if (change.op === "added") return style.added(change.after ?? "");
	if (change.op === "removed") return style.removed(change.before ?? "");
	return wordDiff(change.before ?? "", change.after ?? "")
		.map((segment) => (segment.op === "=" ? segment.text : segment.op === "+" ? style.added(segment.text) : style.removed(segment.text)))
		.join("");
}

/** Logical lines (before wrapping) describing a change set. */
export function changeLines(change: ChangeSet, style: Styler): string[] {
	const lines = [
		style.title(`${change.id}  ${new Date(change.time).toLocaleString()}${change.undoneBy ? "（已撤回）" : ""}`),
		`请求：${change.prompt.replace(/\s+/g, " ")}`,
	];
	if (change.summary) lines.push(style.reason(`原因：${change.summary}`));
	for (const note of change.notes ?? []) lines.push(style.reason(`备注：${note}`));
	const blocks = change.blocks ?? [];
	let file = "";
	for (const block of blocks) {
		if (block.file !== file) {
			file = block.file;
			lines.push("", style.title(`■ ${file}`));
		}
		lines.push("", `${style.title(`${block.title}`)} ${style.dim(`（${OP_LABEL[block.op]}）`)}`);
		if (block.why) lines.push(style.reason(`为什么：${block.why}`));
		lines.push(...blockBody(block, style).split("\n"));
	}
	const other = change.files.filter((f) => f.binary || !blocks.some((block) => block.file === f.path));
	if (other.length > 0) {
		lines.push("", style.dim(`其他文件（不逐块比较）：${other.map((f) => f.path).join("、")}`));
	}
	if (blocks.length === 0 && other.length === 0) lines.push("", style.dim("（没有文件改动）"));
	return lines;
}

/** A scrollable full-screen view of some lines. ↑↓ PgUp PgDn Home End scroll; Esc or q closes. */
export class ScrollViewer {
	private offset = 0;
	private cache?: { width: number; lines: string[] };
	private readonly lines: string[];
	private readonly height: () => number;
	private readonly onClose: () => void;
	private readonly requestRender: () => void;
	private readonly footer: (text: string) => string;

	constructor(lines: string[], options: { height: () => number; onClose: () => void; requestRender: () => void; footer: (text: string) => string }) {
		this.lines = lines;
		this.height = options.height;
		this.onClose = options.onClose;
		this.requestRender = options.requestRender;
		this.footer = options.footer;
	}

	private wrapped(width: number): string[] {
		if (this.cache?.width !== width) {
			this.cache = { width, lines: this.lines.flatMap((line) => (line ? wrapTextWithAnsi(line, Math.max(10, width - 2)) : [""])) };
		}
		return this.cache.lines;
	}

	render(width: number): string[] {
		const all = this.wrapped(width);
		const page = Math.max(5, this.height() - 2);
		this.offset = Math.max(0, Math.min(this.offset, Math.max(0, all.length - page)));
		const visible = all.slice(this.offset, this.offset + page).map((line) => truncateToWidth(` ${line}`, width));
		const position = all.length > page ? `${this.offset + 1}-${Math.min(all.length, this.offset + page)}/${all.length}` : "";
		return [...visible, this.footer(truncateToWidth(` ↑↓ PgUp PgDn 滚动 · Esc 关闭  ${position}`, width))];
	}

	handleInput(data: string): void {
		const page = Math.max(5, this.height() - 2);
		if (matchesKey(data, "escape") || data === "q") return this.onClose();
		if (matchesKey(data, "up")) this.offset -= 1;
		else if (matchesKey(data, "down")) this.offset += 1;
		else if (matchesKey(data, "pageUp")) this.offset -= page;
		else if (matchesKey(data, "pageDown") || data === " ") this.offset += page;
		else if (matchesKey(data, "home")) this.offset = 0;
		else if (matchesKey(data, "end")) this.offset = Number.MAX_SAFE_INTEGER;
		else return;
		this.requestRender();
	}

	invalidate(): void {
		this.cache = undefined;
	}
}

async function showChange(ctx: ExtensionContext, change: ChangeSet): Promise<void> {
	if (ctx.mode !== "tui") {
		const text = changeLines(change, PLAIN_STYLE).join("\n");
		if (ctx.hasUI) ctx.ui.notify(text, "info");
		else console.log(text);
		return;
	}
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		return new ScrollViewer(changeLines(change, themeStyle(theme)), {
			height: () => (process.stdout.rows ?? 32) - 2,
			onClose: () => done(undefined),
			requestRender: () => tui.requestRender(),
			footer: (text) => theme.fg("dim", text),
		});
	});
}

export function registerChangesCommand(pi: ExtensionAPI, getHistory: (cwd: string) => History): void {
	pi.registerCommand("changes", {
		description: "查看各轮修改：/changes 列表；/changes c0003 逐块查看（含字词级差异与原因）",
		handler: async (args, ctx) => {
			const store = getHistory(ctx.cwd).changes;
			const spec = args.trim();
			if (spec) {
				const [change] = selectChanges(store, spec);
				if (!change) return ctx.ui.notify(`没有 ${spec}。`, "warning");
				return showChange(ctx, change);
			}
			const list = store.list().slice(-15);
			if (list.length === 0) return ctx.ui.notify("还没有记录到修改。", "info");
			ctx.ui.notify(
				list
					.map((change) => `${change.id}${change.undoneBy ? "（已撤回）" : ""} ${change.prompt.replace(/\s+/g, " ").slice(0, 36)} — ${describeChange(change, 3)}`)
					.join("\n"),
				"info",
			);
		},
	});
}
