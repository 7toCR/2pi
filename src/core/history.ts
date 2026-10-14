import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BlockExtractor } from "./blocks.ts";
import { Checkpoints, type FileChange } from "./checkpoints.ts";
import { changesWidget } from "../ui/widgets.ts";
import { STATE_DIR } from "./project.ts";
import {
	attachReasons,
	type BlockChange,
	blockChanges,
	documentDiffs,
	type Reason,
	summarizeBlockChanges,
} from "./review.ts";

/**
 * Turn history: a checkpoint before and after every agent turn, and a change set describing what
 * the turn changed, block by block, with the model's reasons. Change sets are the one format every
 * view renders: the TUI widget and viewer, the HTML review page and the redline documents.
 */

export interface ChangeSet {
	id: string;
	seq: number;
	prompt: string;
	before: string;
	after: string;
	time: number;
	files: FileChange[];
	/** What the turn changed, block by block (text files only). */
	blocks?: BlockChange[];
	/** The model's one-sentence account of the turn (report_changes). */
	summary?: string;
	/** Reasons the model gave that matched no changed block. */
	notes?: string[];
	/** Set when /undo reverted this turn. */
	undoneBy?: string;
}

export const CHANGES_WIDGET = "2pi-changes";

export class ChangeStore {
	readonly dir: string;

	constructor(cwd: string) {
		this.dir = join(cwd, STATE_DIR, "changes");
	}

	list(): ChangeSet[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir)
			.filter((name) => /^c\d+\.json$/.test(name))
			.map((name) => JSON.parse(readFileSync(join(this.dir, name), "utf8")) as ChangeSet)
			.sort((a, b) => a.seq - b.seq);
	}

	get(id: string): ChangeSet | undefined {
		return this.list().find((change) => change.id === id);
	}

	save(change: ChangeSet): void {
		mkdirSync(this.dir, { recursive: true });
		writeFileSync(join(this.dir, `${change.id}.json`), `${JSON.stringify(change, null, 2)}\n`, "utf8");
	}

	add(change: Omit<ChangeSet, "id" | "seq">): ChangeSet {
		const seq = (this.list().at(-1)?.seq ?? 0) + 1;
		const full: ChangeSet = { id: `c${String(seq).padStart(4, "0")}`, seq, ...change };
		this.save(full);
		return full;
	}

	/** The latest turn that is not already undone and is not itself an undo. */
	lastUndoable(): ChangeSet | undefined {
		return this.list()
			.filter((change) => !change.undoneBy && !change.prompt.startsWith("/undo"))
			.at(-1);
	}
}

export function describeFiles(files: FileChange[], limit = 6): string {
	const mark = { added: "新增", modified: "修改", deleted: "删除" } as const;
	const shown = files.slice(0, limit).map((file) => {
		const stat = file.binary ? "二进制" : `+${file.additions} −${file.deletions}`;
		return `${file.path}（${mark[file.status]} ${stat}）`;
	});
	const more = files.length > limit ? ` 等共 ${files.length} 个文件` : "";
	return `${shown.join("、")}${more}`;
}

/** The change summary a person reads: changed blocks when known, else changed files. */
export function describeChange(change: ChangeSet, limit = 6): string {
	return change.blocks && change.blocks.length > 0 ? summarizeBlockChanges(change.blocks, limit) : describeFiles(change.files, limit);
}

export class History {
	readonly checkpoints: Checkpoints;
	readonly changes: ChangeStore;
	readonly extractors: BlockExtractor[];
	private pending?: { prompt: string; before: string; summary?: string; reasons: Reason[]; reported: boolean };

	constructor(cwd: string, extractors: BlockExtractor[] = []) {
		this.checkpoints = new Checkpoints(cwd);
		this.changes = new ChangeStore(cwd);
		this.extractors = extractors;
	}

	/** Before a turn: capture edits the user made since the last turn as their own checkpoint. */
	beginTurn(prompt: string): void {
		const before = this.checkpoints.snapshot("手动修改");
		this.pending = before ? { prompt, before, reasons: [], reported: false } : undefined;
	}

	/** Block changes of the turn so far (work tree against the turn's starting checkpoint). */
	currentChanges(): BlockChange[] {
		if (!this.pending) return [];
		return blockChanges(documentDiffs(this.checkpoints, this.extractors, this.pending.before, undefined));
	}

	/**
	 * Record the model's account of the turn (called again to add reasons, possibly without a new
	 * summary); returns the turn's changes with all reasons so far attached.
	 */
	report(summary: string | undefined, reasons: Reason[]): { changes: BlockChange[]; unmatched: Reason[] } {
		if (!this.pending) return { changes: [], unmatched: reasons };
		this.pending.reported = true;
		this.pending.summary = summary?.trim() || this.pending.summary;
		this.pending.reasons = [...this.pending.reasons, ...reasons];
		return attachReasons(this.currentChanges(), this.pending.reasons);
	}

	/**
	 * Drafts a pack understands (a patent JSON, a LaTeX source) that existed before this turn and
	 * were revised in it while the model has not said why. A new draft is explained by the request
	 * itself; plain files and generated outputs need no account.
	 */
	owesReport(packExtractors: BlockExtractor[]): string[] {
		if (!this.pending || this.pending.reported) return [];
		const drafts = this.checkpoints.diffToWorktree(this.pending.before).filter((file) => {
			if (file.binary || file.status !== "modified") return false;
			const content = readSafe(join(this.checkpoints.cwd, file.path));
			return packExtractors.some((extract) => extract(file.path, content) !== undefined);
		});
		if (drafts.length === 0) return [];
		// Only text a reviewer reads counts: a build refreshing generated fields changes no block.
		return documentDiffs(this.checkpoints, packExtractors, this.pending.before, undefined, drafts)
			.filter((diff) => diff.blocks.some((block) => block.status !== "unchanged"))
			.map((diff) => diff.path);
	}

	/** After a turn: checkpoint and record what the turn changed. */
	endTurn(): ChangeSet | undefined {
		const pending = this.pending;
		this.pending = undefined;
		if (!pending) return undefined;
		const seq = (this.changes.list().at(-1)?.seq ?? 0) + 1;
		const after = this.checkpoints.snapshot(`第 ${seq} 轮：${pending.prompt.replace(/\s+/g, " ").slice(0, 72)}`);
		if (!after || after === pending.before) return undefined;
		const files = this.checkpoints.diff(pending.before, after);
		if (files.length === 0) return undefined;
		const { changes, unmatched } = attachReasons(
			blockChanges(documentDiffs(this.checkpoints, this.extractors, pending.before, after, files)),
			pending.reasons,
		);
		return this.changes.add({
			prompt: pending.prompt,
			before: pending.before,
			after,
			time: Date.now(),
			files,
			blocks: changes,
			...(pending.summary ? { summary: pending.summary } : {}),
			...(unmatched.length > 0 ? { notes: unmatched.map((reason) => `${reason.target}：${reason.why}`) } : {}),
		});
	}

	/** Undo the latest turn. Returns a message for the user. */
	undo(force: boolean): string {
		const target = this.changes.lastUndoable();
		if (!target) return "没有可撤回的修改。";
		const { restored, conflicts } = this.checkpoints.revert(target.before, target.after, target.files, force);
		if (conflicts.length > 0 && !force) {
			return `以下文件在 ${target.id} 之后又被修改过，未撤回：${conflicts.join("、")}。确认要覆盖时用 /undo force。`;
		}
		const before = this.checkpoints.head() ?? target.after;
		const after = this.checkpoints.snapshot(`撤回 ${target.id}`);
		if (after && after !== before) {
			const files = this.checkpoints.diff(before, after);
			const undo = this.changes.add({
				prompt: `/undo ${target.id}`,
				before,
				after,
				time: Date.now(),
				files,
				blocks: blockChanges(documentDiffs(this.checkpoints, this.extractors, before, after, files)),
				summary: `撤回 ${target.id}`,
			});
			this.changes.save({ ...target, undoneBy: undo.id });
		} else {
			this.changes.save({ ...target, undoneBy: "undo" });
		}
		return `已撤回 ${target.id}（${target.prompt.slice(0, 40)}）：恢复了 ${restored.length} 个文件。`;
	}
}

function readSafe(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

/** Change sets named by "c0003", "c0001..c0003", or nothing (the latest). */
export function selectChanges(store: ChangeStore, spec: string | undefined): ChangeSet[] {
	const all = store.list();
	const value = (spec ?? "").trim();
	if (!value) return all.slice(-1);
	const range = /^(c\d+)\s*(?:\.\.|-|~)\s*(c\d+)$/i.exec(value);
	if (range) {
		const from = all.findIndex((change) => change.id === range[1]?.toLowerCase());
		const to = all.findIndex((change) => change.id === range[2]?.toLowerCase());
		return from >= 0 && to >= from ? all.slice(from, to + 1) : [];
	}
	return all.filter((change) => change.id === value.toLowerCase());
}

/** Wire turn checkpoints, the change widget, and /undo, /checkpoints. */
export function installHistory(pi: ExtensionAPI, getHistory: (cwd: string) => History): void {
	pi.on("before_agent_start", (event, ctx) => {
		getHistory(ctx.cwd).beginTurn(event.prompt);
		if (ctx.hasUI) ctx.ui.setWidget(CHANGES_WIDGET, undefined);
	});

	pi.on("agent_settled", (_event, ctx) => {
		const change = getHistory(ctx.cwd).endTurn();
		if (change && ctx.hasUI) {
			if (ctx.mode === "tui") ctx.ui.setWidget(CHANGES_WIDGET, changesWidget(change.id, describeChange(change, 6), change.summary));
			else
				ctx.ui.setWidget(CHANGES_WIDGET, [
					`本轮修改（${change.id}）：${describeChange(change, 6)}`,
					...(change.summary ? [`原因：${change.summary}`] : []),
					`/changes ${change.id} 逐块查看 · /redline 生成修订稿 · /undo 撤回`,
				]);
		}
	});

	const notify = (ctx: ExtensionContext, text: string, level: "info" | "warning" = "info") =>
		ctx.hasUI ? ctx.ui.notify(text, level) : console.log(text);

	pi.registerCommand("undo", {
		description: "撤回上一轮 agent 对文件的修改（/undo force 覆盖之后的手动修改）",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) return notify(ctx, "agent 正在运行，等这一轮结束再撤回。", "warning");
			const history = getHistory(ctx.cwd);
			if (!history.checkpoints.ensure()) return notify(ctx, history.checkpoints.disabledReason ?? "检查点不可用", "warning");
			notify(ctx, history.undo(args.trim() === "force"));
			if (ctx.hasUI) ctx.ui.setWidget(CHANGES_WIDGET, undefined);
		},
	});

	pi.registerCommand("checkpoints", {
		description: "列出最近的文件检查点",
		handler: async (_args, ctx) => {
			const checkpoints = getHistory(ctx.cwd).checkpoints;
			if (!checkpoints.ensure()) return notify(ctx, checkpoints.disabledReason ?? "检查点不可用", "warning");
			const entries = checkpoints.log(20);
			notify(
				ctx,
				entries.length === 0
					? "还没有检查点。"
					: entries.map((entry) => `${entry.commit} ${new Date(entry.time).toLocaleString()} ${entry.message}`).join("\n"),
			);
		},
	});
}
