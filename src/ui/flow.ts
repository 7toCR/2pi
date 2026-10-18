import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { describeCall, describeResult, type ResultLike } from "./tool-rows.ts";

/**
 * Where the current run is, for the side panel, in two views that F3 switches between.
 *
 * The track: the steps a research-writing run is made of, as a small tree under the request.
 * 2pi does not fix a workflow, so the steps are the usual order for the project's domains, the
 * paper and the patent steps are grouped, and each tool call lights the step it belongs to.
 * Steps not reached yet hang on dotted branches; the step at work lists its latest calls under it;
 * a group this run does not touch folds into one line. When the model goes back to an earlier
 * step, the step it left says where it went (↺), the step it went back to counts its visits, and
 * the steps after that one fade until they are reached again.
 *
 *     ◆ 把 paper.pdf 写成专利
 *     ├─● 解析材料           已解析 12 页
 *     ├─▸ 论文                     4/4 ✓
 *     ├─▾ 专利                       0/4
 *     │ ├─⠋ 撰写专利 ×2  patent.json…
 *     │ │ └ ⠋ 编辑 patent/patent.json
 *     │ ├─✗ 形式检查  2 错误 ↺ 撰写专利
 *     │ ├┄○ 生成文件
 *     │ └┄○ 核对渲染
 *     ├┄○ 交付前检查
 *     ╰┄◇ 完成
 *
 * The tree: the run as it grew. The request is the root, every step reached grows a child of the
 * current node, and a way back forks a new branch from the last node before that step, so a
 * failed attempt stays in view, faded, beside the branch being worked on.
 *
 *          ◆ 把 paper.pdf 写成专利
 *                     │
 *                ● 解析材料
 *            ╭────────┴────────╮
 *       ● 撰写专利      ⠋ 撰写专利 ×2
 *            │
 *       ✗ 形式检查
 *
 * Pure data plus rendering to strings, so it is tested without a terminal.
 */

export type NodeState = "idle" | "active" | "wait" | "done" | "failed";
export type FlowView = "track" | "tree";
type Color = Parameters<Theme["fg"]>[0];

interface StageSpec {
	key: string;
	label: string;
	/** Part of the usual track for these domains ("*": every project); others appear once used. */
	domains?: string[];
	/** The group the step is listed under on the track. */
	group?: string;
}

/** Every step, in the order a run usually goes through them. */
export const STAGES: StageSpec[] = [
	{ key: "ingest", label: "解析材料", domains: ["*"] },
	{ key: "research", label: "调研检索", domains: ["research"] },
	{ key: "evidence", label: "证据账本", domains: ["paper"], group: "paper" },
	{ key: "paper_draft", label: "撰写论文", domains: ["paper"], group: "paper" },
	{ key: "paper_build", label: "编译 PDF", domains: ["paper"], group: "paper" },
	{ key: "paper_check", label: "论文检查", domains: ["paper"], group: "paper" },
	{ key: "patent_draft", label: "撰写专利", domains: ["patent"], group: "patent" },
	{ key: "patent_check", label: "形式检查", domains: ["patent"], group: "patent" },
	{ key: "patent_build", label: "生成文件", domains: ["patent"], group: "patent" },
	{ key: "review", label: "核对渲染", domains: ["patent"], group: "patent" },
	{ key: "gate", label: "交付前检查", domains: ["*"] },
	{ key: "report", label: "修改说明" },
];

const GROUPS: Record<string, string> = { paper: "论文", patent: "专利" };
const GROUP_OF = new Map(STAGES.flatMap((stage) => (stage.group ? [[stage.key, stage.group] as const] : [])));

export const USER = "user";
export const DONE = "done";
/** Keys of rows that are not steps: the footer switches the view, a group row folds its group. */
export const VIEW_KEY = "@view";
const GROUP_KEY = "@group:";
const ORDER = new Map<string, number>([[USER, -1], ...STAGES.map((stage, index) => [stage.key, index] as const), [DONE, STAGES.length]]);
const LABEL = new Map<string, string>([[USER, "你"], ...STAGES.map((stage) => [stage.key, stage.label] as const), [DONE, "完成"]]);

const COMPILERS = /\b(latexmk|tectonic|xelatex|pdflatex|lualatex|bibtex|biber)\b/;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const str = (value: unknown) => (typeof value === "string" ? value.replace(/\\/g, "/") : "");

/** The step a tool call belongs to, or undefined for general work (reading code, listing files). */
export function nodeForTool(toolName: string, args: Record<string, unknown>): string | undefined {
	const path = str(args.path ?? args.file ?? args.file_path);
	switch (toolName) {
		case "paper_ingest":
			return "ingest";
		case "lit_search":
		case "lit_fetch":
		case "patent_search":
		case "patent_import":
		case "bib_lookup":
			return "research";
		case "evidence":
		case "compute_stats":
			return "evidence";
		case "paper_init":
		case "fill_gaps":
			return "paper_draft";
		case "latex_compile":
			return "paper_build";
		case "check_draft":
			return "paper_check";
		case "patent_check":
			return "patent_check";
		case "patent_build":
			return "patent_build";
		case "pdf_preview":
			return "review";
		case "report_changes":
		case "redline":
			return "report";
		case "read":
			// Looking at rendered drawings is reviewing; reading materials while writing is not a new ingest.
			return IMAGE.test(path) ? "review" : undefined;
		case "write":
		case "edit":
			if (/(^|\/)patent(\/|[^/]*\.json$)/i.test(path)) return "patent_draft";
			if (/\.(tex|bib|cls|sty)$/i.test(path) || /(^|\/)(paper\/|PAPER\.md$)/.test(path)) return "paper_draft";
			if (/(^|\/)notes\/evidence\.json$/.test(path)) return "evidence";
			return undefined;
		case "bash":
		case "powershell":
			return COMPILERS.test(str(args.command)) ? "paper_build" : undefined;
		default:
			return undefined;
	}
}

export interface FlowAction {
	verb: string;
	target: string;
	summary?: string;
	ok?: boolean;
	durationMs?: number;
	at: number;
}

interface FlowNode {
	key: string;
	state: NodeState;
	note: string;
	/** Visits in the current run. */
	visits: number;
	/** Run number of the last change, so steps from earlier runs are drawn faded. */
	run: number;
	actions: FlowAction[];
}

export interface PlanStepView {
	step: string;
	status: "pending" | "in_progress" | "completed";
}

/** A dropped connection, reported by the reconnect logic. */
export interface NetworkStatus {
	/** "retry": the request is retried after a delay; "offline": waiting for the network. */
	phase: "retry" | "offline";
	attempt: number;
	max?: number;
	/** Epoch ms of the next attempt or probe. */
	nextAt?: number;
	error?: string;
}

/** A way back to an earlier step. */
interface Loop {
	from: string;
	to: string;
	count: number;
}

/** One visit to a step, as a node of the tree view. */
interface TreeNode {
	key: string;
	/** Index of the parent node; -1 for the root. */
	parent: number;
	/** Which visit to the step this is (×2 from the second on). */
	visit: number;
	state: NodeState;
}

/** A clickable span of a rendered line: the tree has several nodes on one line. */
interface Hit {
	y: number;
	x0: number;
	x1: number;
	key: string;
}

interface Row {
	text: string;
	key?: string;
	hits?: Omit<Hit, "y">[];
}

interface Cell {
	ch: string;
	color?: Color;
	bold?: boolean;
}

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const MAX_ACTIONS = 60;
/** Calls listed under the step at work. */
const MAX_CALLS = 3;
/** Frames (70 ms each) the branch to a newly reached step stays lit. */
const FRESH_FRAMES = 10;
/** Columns between neighbouring branches of the tree. */
const TREE_GAP = 3;
/** Box-drawing characters by the directions a tree cell connects (up, down, left, right). */
const BOX: Record<string, string> = {
	u: "│",
	d: "│",
	ud: "│",
	l: "─",
	r: "─",
	lr: "─",
	dr: "╭",
	dl: "╮",
	ur: "╰",
	ul: "╯",
	udr: "├",
	udl: "┤",
	dlr: "┬",
	ulr: "┴",
	udlr: "┼",
};
/** Tree edges by rank: off the current path, on it, just grown. */
const EDGE: Color[] = ["dim", "dim", "muted", "accent"];

function clock(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	return minutes >= 60
		? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
		: `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function oneLine(text: string, limit = 80): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function pad(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

/** `left`, then `right` flush with the right edge; `right` is cut first when the line is short. */
function fit(left: string, right: string, width: number): string {
	const used = visibleWidth(left);
	if (!right || used + 5 > width) return truncateToWidth(left, width, "…");
	const cut = truncateToWidth(right, width - used - 2, "…");
	return `${left}${" ".repeat(Math.max(2, width - used - visibleWidth(cut)))}${cut}`;
}

export class FlowModel {
	private nodes = new Map<string, FlowNode>();
	private running = new Map<string, { key?: string; toolName: string; args: Record<string, unknown>; verb: string; target: string }>();
	private domains: string[] = [];
	/** Steps of the current run in the order they were reached. */
	private trail: string[] = [];
	/** Steps reached since the last way back (the current pass). */
	private pass = new Set<string>();
	private loops: Loop[] = [];
	/** The run as it grew, for the tree view; `cursor` is the node being worked on. */
	private tree: TreeNode[] = [];
	private cursor = -1;
	/** The step just reached: the branch to it is lit for a few frames. */
	private fresh?: { key: string; frames: number };
	/** Groups folded or unfolded by a click, until the next run. */
	private folds = new Map<string, boolean>();
	private foldedNow = new Map<string, boolean>();
	private runNumber = 0;
	private runStarted?: number;
	private runEnded?: number;
	private activity = "";
	private tools = 0;
	private tokens = 0;
	private rowKeys: (string | undefined)[] = [];
	private hits: Hit[] = [];
	view: FlowView = "track";
	plan: PlanStepView[] = [];
	network?: NetworkStatus;
	/** Injected clock, for tests. */
	now: () => number = Date.now;

	constructor() {
		for (const key of ORDER.keys()) this.nodes.set(key, { key, state: "idle", note: "", visits: 0, run: 0, actions: [] });
	}

	private get(key: string): FlowNode {
		const node = this.nodes.get(key);
		if (!node) throw new Error(`unknown flow node ${key}`);
		return node;
	}

	private set(key: string, state: NodeState, note?: string): void {
		const node = this.get(key);
		node.state = state;
		node.run = this.runNumber;
		if (note !== undefined) node.note = note;
		const visit = this.tree.findLast((item) => item.key === key);
		if (visit) visit.state = state;
	}

	/** The run reached `key`: extend the trail and the tree, and record a loop when it went back. */
	private reach(key: string): void {
		const last = this.trail.at(-1);
		if (last === key) return;
		// Any move up the track is a way back: a check sending the draft back, a second search.
		const back = last !== undefined && last !== USER && (ORDER.get(key) ?? 0) < (ORDER.get(last) ?? 0);
		if (back && last) {
			const loop = this.loops.find((item) => item.from === last && item.to === key);
			if (loop) loop.count += 1;
			else this.loops.push({ from: last, to: key, count: 1 });
			this.pass = new Set([key]);
		} else {
			this.pass.add(key);
		}
		this.trail.push(key);
		const node = this.get(key);
		node.visits += 1;
		if (this.tree.length === 0 && key !== USER) {
			this.tree.push({ key: USER, parent: -1, visit: 1, state: this.get(USER).state });
			this.cursor = 0;
		}
		// A step forward grows a child of the current node; a way back forks a new branch from the
		// last node on the current path that comes before the step in the usual order.
		let parent = this.cursor;
		const order = ORDER.get(key) ?? 0;
		if (back) while (parent > 0 && (ORDER.get(this.tree[parent].key) ?? 0) >= order) parent = this.tree[parent].parent;
		this.tree.push({ key, parent, visit: node.visits, state: node.state });
		this.cursor = this.tree.length - 1;
		this.fresh = { key, frames: FRESH_FRAMES };
	}

	setDomains(domains: string[]): void {
		this.domains = domains;
	}

	/** A new user prompt: a new run starts at the user. Earlier results stay, faded. */
	startRun(prompt: string): void {
		this.runNumber += 1;
		for (const node of this.nodes.values()) {
			node.visits = 0;
			if (node.state === "active" || node.state === "wait") node.state = "done";
		}
		this.running.clear();
		this.network = undefined;
		this.trail = [];
		this.pass = new Set();
		this.loops = [];
		this.tree = [];
		this.cursor = -1;
		this.folds.clear();
		this.runStarted = this.now();
		this.runEnded = undefined;
		this.tools = 0;
		this.tokens = 0;
		this.activity = "思考中…";
		this.reach(USER);
		this.set(USER, "done", oneLine(prompt, 60));
		Object.assign(this.get(DONE), { state: "idle", note: "" });
	}

	/** The model is streaming: thinking or writing its answer. */
	assistantActivity(kind: "thinking" | "text"): void {
		if (this.running.size === 0) this.activity = kind === "thinking" ? "思考中…" : "撰写回复…";
	}

	turnStart(): void {
		this.network = undefined;
		if (this.running.size === 0) this.activity = "思考中…";
	}

	addUsage(tokens: number): void {
		if (Number.isFinite(tokens)) this.tokens += tokens;
	}

	toolStart(id: string, toolName: string, args: Record<string, unknown>, cwd: string): void {
		const key = nodeForTool(toolName, args);
		const { verb, target } = describeCall(toolName, args, cwd);
		this.running.set(id, { key, toolName, args, verb, target });
		this.tools += 1;
		this.activity = `${verb}${target ? ` ${target}` : ""}…`;
		if (!key) return;
		this.reach(key);
		this.set(key, "active", target ? `${target}…` : "进行中…");
	}

	toolEnd(id: string, result: ResultLike | undefined, isError: boolean, durationMs?: number): void {
		const call = this.running.get(id);
		this.running.delete(id);
		const summary = call && result ? describeResult(call.toolName, result, call.args, isError) : undefined;
		if (call?.key) {
			const node = this.get(call.key);
			node.actions.push({ verb: call.verb, target: call.target, summary, ok: !isError, durationMs, at: this.now() });
			node.actions.splice(0, Math.max(0, node.actions.length - MAX_ACTIONS));
			// Another call to the same step may still run (parallel tool calls).
			const busy = [...this.running.values()].some((other) => other.key === call.key);
			if (!busy) this.set(call.key, isError ? "failed" : "done", summary ?? (isError ? "未通过" : "完成"));
		}
		if (this.running.size === 0) this.activity = "思考中…";
	}

	/** A dialog waits for the user (ask_user, a confirmation). */
	waitingForUser(waiting: boolean, title?: string): void {
		const user = this.get(USER);
		if (waiting) {
			user.actions.push({ verb: "提问", target: title ?? "", at: this.now() });
			this.activity = title ? `等你回答：${oneLine(title, 40)}` : "等你回答";
			user.state = "wait";
		} else if (user.state === "wait") {
			user.state = "done";
			this.activity = "思考中…";
		}
	}

	/** The end-of-turn check: undefined when it found nothing to report. */
	gate(report: { headline: string; blocking: boolean; fixing: boolean } | undefined): void {
		const node = this.get("gate");
		this.reach("gate");
		this.set("gate", report?.blocking ? "failed" : "done", report ? report.headline : "通过");
		node.actions.push({ verb: "检查", target: report ? report.headline : "通过", ok: !report?.blocking, at: this.now() });
		if (report?.fixing) this.activity = "按检查结果修改…";
	}

	setNetwork(status: NetworkStatus | undefined): void {
		this.network = status;
	}

	settled(outcome: "completed" | "aborted" | "error", error?: string): void {
		this.runEnded = this.now();
		this.running.clear();
		this.network = undefined;
		const end: NodeState = outcome === "completed" ? "done" : "failed";
		for (const node of this.nodes.values()) if (node.state === "active") node.state = end;
		for (const node of this.tree) if (node.state === "active") node.state = end;
		const took = this.runStarted !== undefined ? clock(this.runEnded - this.runStarted) : "";
		this.reach(DONE);
		if (outcome === "completed") this.set(DONE, "done", took ? `用时 ${took}` : "");
		else if (outcome === "aborted") this.set(DONE, "failed", "已中断");
		else this.set(DONE, "failed", error ? oneLine(error, 60) : "出错");
		if (this.get(USER).state === "wait") this.get(USER).state = "done";
		this.activity = outcome === "completed" ? "本轮完成" : outcome === "aborted" ? "已中断" : "出错";
	}

	/** Count down the lit branch; whether anything still needs animating. */
	advance(): boolean {
		if (this.fresh && --this.fresh.frames <= 0) this.fresh = undefined;
		return this.lively;
	}

	get lively(): boolean {
		return !!this.fresh || !!this.network || [...this.nodes.values()].some((node) => node.state === "active" || node.state === "wait");
	}

	get isRunning(): boolean {
		return this.runStarted !== undefined && this.runEnded === undefined;
	}

	/** The steps on the track: the usual ones for the domains, plus any used in this session. */
	private route(): string[] {
		const domains = new Set(this.domains);
		const stages = STAGES.filter(
			(stage) =>
				stage.domains?.some((domain) => domain === "*" || domains.has(domain)) ||
				this.get(stage.key).run > 0 ||
				this.trail.includes(stage.key),
		);
		return [USER, ...stages.map((stage) => stage.key), DONE];
	}

	/** What is drawn at line `y` (and column `x`, for the tree) of the last render, for clicks. */
	keyAt(y: number, x?: number): string | undefined {
		if (x !== undefined) {
			const hit = this.hits.find((item) => item.y === y && x >= item.x0 && x < item.x1);
			if (hit) return hit.key;
		}
		return this.rowKeys[y];
	}

	/** Fold or unfold the group a row key names; false when the key is not a group's. */
	toggleGroup(key: string): boolean {
		if (!key.startsWith(GROUP_KEY)) return false;
		const group = key.slice(GROUP_KEY.length);
		this.folds.set(group, !(this.foldedNow.get(group) ?? false));
		return true;
	}

	private glyph(key: string, state: NodeState, frame: number, faded: boolean): [string, Color] {
		if (key === USER) {
			if (state === "wait") return ["?", frame % 16 < 10 ? "accent" : "dim"];
			return state === "idle" ? ["◇", "dim"] : ["◆", faded ? "dim" : "accent"];
		}
		if (key === DONE) {
			if (state === "done") return ["◆", faded ? "dim" : "success"];
			return state === "failed" ? ["✗", "error"] : ["◇", "dim"];
		}
		switch (state) {
			case "active":
				return [SPIN[Math.floor(frame / 2) % SPIN.length] ?? "⠋", "accent"];
			case "done":
				return ["●", faded ? "dim" : "success"];
			case "failed":
				// A failure stays red while it is the step's latest result: it is why the run went back.
				return ["✗", "error"];
			default:
				return ["○", "dim"];
		}
	}

	private label(theme: Theme, text: string, state: NodeState, faded: boolean): string {
		if (state === "active" || state === "wait") return theme.bold(theme.fg("accent", text));
		if (faded || state === "idle") return theme.fg("dim", text);
		return theme.fg(state === "failed" ? "error" : "text", text);
	}

	private header(width: number, frame: number, theme: Theme): string[] {
		const end = this.runEnded ?? this.now();
		const right = this.runStarted !== undefined ? theme.fg("dim", clock(end - this.runStarted)) : "";
		const left = this.isRunning
			? `${theme.fg("accent", SPIN[Math.floor(frame / 2) % SPIN.length] ?? "⠋")} ${theme.fg("text", this.activity)}`
			: `${theme.fg("dim", "·")} ${theme.fg("muted", this.runStarted !== undefined ? this.activity : "就绪")}`;
		const room = Math.max(4, width - visibleWidth(right) - 1);
		const lines = [`${pad(truncateToWidth(left, room, "…"), room)}${right ? ` ${right}` : ""}`];
		if (this.runStarted !== undefined) {
			const loops = this.loops.reduce((sum, loop) => sum + loop.count, 0);
			const stats = [
				`工具 ${this.tools}`,
				...(this.tokens > 0 ? [`${(this.tokens / 1000).toFixed(this.tokens < 10_000 ? 1 : 0)}k tokens`] : []),
				...(loops > 0 ? [`回环 ${loops}`] : []),
			];
			lines.push(theme.fg("dim", stats.join(" · ")));
		}
		if (this.network) lines.push(theme.fg("warning", `! ${this.networkNote(this.network)}`));
		return lines.map((line) => truncateToWidth(line, width, "…"));
	}

	private networkNote(status: NetworkStatus): string {
		const wait = status.nextAt ? Math.max(0, Math.ceil((status.nextAt - this.now()) / 1000)) : undefined;
		const when = wait === undefined ? "" : wait > 0 ? ` · ${wait}s 后` : " · 正在";
		return status.phase === "offline"
			? `连接中断${when}探测网络（第 ${status.attempt} 次）`
			: `重连中 ${status.attempt}/${status.max ?? "?"}${when}${wait === undefined ? "" : "重试"}`;
	}

	private planLines(width: number, theme: Theme): string[] {
		if (this.plan.length === 0) return [];
		const done = this.plan.filter((step) => step.status === "completed").length;
		const lines = [`${theme.fg("muted", "计划")} ${theme.fg("dim", `${done}/${this.plan.length}`)}`];
		// Long plans keep the current step in view: the last two finished steps, then what is left.
		const current = this.plan.findIndex((step) => step.status !== "completed");
		const start = Math.max(0, (current < 0 ? this.plan.length : current) - 2);
		const shown = this.plan.slice(start, start + 9);
		if (start > 0) lines.push(theme.fg("dim", `  … 已完成 ${start} 步`));
		for (const step of shown) {
			lines.push(
				step.status === "completed"
					? theme.fg("dim", `✓ ${step.step}`)
					: step.status === "in_progress"
						? `${theme.fg("accent", "›")} ${theme.fg("text", step.step)}`
						: `${theme.fg("dim", "·")} ${theme.fg("muted", step.step)}`,
			);
		}
		const rest = this.plan.length - start - shown.length;
		if (rest > 0) lines.push(theme.fg("dim", `  … 还有 ${rest} 步`));
		return lines.map((line) => truncateToWidth(line, width, "…"));
	}

	/** The whole panel: status, the track or the tree, the plan. Every line is at most `width` cells. */
	render(width: number, frame: number, theme: Theme): string[] {
		const w = Math.max(20, width);
		const header = this.header(w, frame, theme);
		const lines: string[] = [...header, ""];
		this.rowKeys = [...header.map(() => undefined), undefined];
		this.hits = [];
		for (const row of this.view === "tree" ? this.treeRows(w, frame, theme) : this.trackRows(w, frame, theme)) {
			for (const hit of row.hits ?? []) this.hits.push({ y: lines.length, ...hit });
			lines.push(truncateToWidth(row.text, w, ""));
			this.rowKeys.push(row.key);
		}
		const plan = this.planLines(w, theme);
		if (plan.length > 0) {
			lines.push("", ...plan);
			this.rowKeys.push(undefined, ...plan.map(() => undefined));
		}
		// The keys first: a narrow panel cuts the end of the line. Clicking the line switches too.
		const hint = this.view === "tree" ? "F3 轨道 · F2 隐藏 · 点击节点看记录" : "F3 树状图 · F2 隐藏 · 点击步骤看记录";
		lines.push("", truncateToWidth(theme.fg("dim", hint), w, ""));
		this.rowKeys.push(undefined, VIEW_KEY);
		return lines;
	}

	/** The latest calls of a step at work, finished ones first, for the rows under it. */
	private calls(key: string, frame: number, theme: Theme): { mark: string; text: string; tail: string }[] {
		const running = [...this.running.values()].filter((call) => call.key === key).slice(-MAX_CALLS);
		const room = MAX_CALLS - running.length;
		const started = this.runStarted ?? 0;
		const finished = room > 0 ? this.get(key).actions.filter((action) => action.at >= started).slice(-room) : [];
		const spin = SPIN[Math.floor(frame / 2) % SPIN.length] ?? "⠋";
		const what = (verb: string, target: string) => `${verb}${target ? ` ${target}` : ""}`;
		return [
			...finished.map((action) => ({
				mark: action.ok === false ? theme.fg("error", "✗") : theme.fg("success", "✓"),
				text: what(action.verb, action.target),
				tail: action.durationMs !== undefined && action.durationMs >= 1000 ? `${(action.durationMs / 1000).toFixed(1)}s` : "",
			})),
			...running.map((call) => ({ mark: theme.fg("accent", spin), text: what(call.verb, call.target), tail: "" })),
		];
	}

	/** The track view: the request, then the steps and groups of steps as one small tree. */
	private trackRows(w: number, frame: number, theme: Theme): Row[] {
		const route = this.route();
		const furthest = Math.max(0, ...route.map((key, index) => (this.pass.has(key) ? index : 0)));
		const ahead = (key: string) => route.indexOf(key) > furthest;
		// Steps from an earlier run, and steps after the one being redone, recede.
		const faded = (key: string) =>
			this.get(key).run !== this.runNumber || (key !== USER && key !== DONE && !this.pass.has(key) && ahead(key));
		const guide = (text: string, lit = false) => theme.fg(lit ? "accent" : "dim", text);
		// The way back is shown on the step that failed and sent the run back; once that step
		// passes, the loop moves to the list under the track.
		const inline = (key: string) => (this.get(key).state === "failed" ? this.loops.findLast((loop) => loop.from === key) : undefined);
		const note = (key: string, room: number) => {
			const node = this.get(key);
			const color: Color = node.state === "active" || node.state === "wait" ? "accent" : node.state === "failed" ? "error" : "dim";
			const text = node.note ? theme.fg(color, node.note) : "";
			const loop = inline(key);
			if (!loop) return text;
			const marker = theme.fg("accent", `↺ ${LABEL.get(loop.to) ?? loop.to}`);
			const space = room - visibleWidth(marker) - 1;
			return text && space >= 4 ? `${truncateToWidth(text, space, "…")} ${marker}` : marker;
		};

		const step = (key: string, lead: string, last: boolean, top: boolean): Row[] => {
			const node = this.get(key);
			const fade = faded(key);
			const [mark, color] = this.glyph(key, node.state, frame, fade);
			const branch = `${last ? (top ? "╰" : "└") : "├"}${ahead(key) ? "┄" : "─"}`;
			const visits = node.visits > 1 ? theme.fg("dim", ` ×${node.visits}`) : "";
			const left = `${lead}${guide(branch, this.fresh?.key === key)}${theme.fg(color, mark)} ${this.label(theme, LABEL.get(key) ?? key, node.state, fade)}${visits}`;
			const rows: Row[] = [{ text: fit(left, note(key, w - visibleWidth(left) - 2), w), key }];
			if (node.state !== "active") return rows;
			const under = `${lead}${guide(last ? "  " : "│ ")}`;
			const calls = this.calls(key, frame, theme);
			calls.forEach((call, index) => {
				const line = `${under}${guide(index === calls.length - 1 ? "└ " : "├ ")}${call.mark} ${theme.fg("muted", call.text)}`;
				rows.push({ text: fit(line, call.tail ? theme.fg("dim", call.tail) : "", w), key });
			});
			return rows;
		};

		const user = this.get(USER);
		const [mark, color] = this.glyph(USER, user.state, frame, faded(USER));
		const request = user.note ? theme.bold(theme.fg(faded(USER) ? "dim" : "text", user.note)) : theme.fg("dim", "你");
		const rows: Row[] = [{ text: truncateToWidth(`${theme.fg(color, mark)} ${request}`, w, "…"), key: USER }];

		// Under the request: steps outside any group, and each run of steps sharing a group.
		const entries: (string | { group: string; keys: string[] })[] = [];
		for (const key of route.slice(1)) {
			const group = GROUP_OF.get(key);
			const previous = entries.at(-1);
			if (!group) entries.push(key);
			else if (typeof previous === "object" && previous.group === group) previous.keys.push(key);
			else entries.push({ group, keys: [key] });
		}
		// A group folds when this run works in other groups but not in it.
		const touched = new Set(route.filter((key) => this.runNumber > 0 && this.get(key).run === this.runNumber).flatMap((key) => GROUP_OF.get(key) ?? []));
		this.foldedNow.clear();
		entries.forEach((entry, index) => {
			const last = index === entries.length - 1;
			if (typeof entry === "string") {
				rows.push(...step(entry, "", last, true));
				return;
			}
			const { group, keys } = entry;
			const busy = keys.some((key) => this.get(key).state === "active" || this.get(key).state === "wait");
			const folded = this.folds.get(group) ?? (!busy && touched.size > 0 && !touched.has(group));
			this.foldedNow.set(group, folded);
			const done = keys.filter((key) => this.get(key).state === "done").length;
			const tone: Color = folded ? "dim" : "muted";
			const branch = `${last ? "╰" : "├"}${keys.every(ahead) ? "┄" : "─"}`;
			const lit = folded && keys.some((key) => this.fresh?.key === key);
			const left = `${guide(branch, lit)}${theme.fg(tone, folded ? "▸" : "▾")} ${theme.fg(tone, GROUPS[group] ?? group)}`;
			rows.push({ text: fit(left, theme.fg("dim", `${done}/${keys.length}${done === keys.length ? " ✓" : ""}`), w), key: `${GROUP_KEY}${group}` });
			if (folded) return;
			const lead = guide(last ? "  " : "│ ");
			keys.forEach((key, at) => rows.push(...step(key, lead, at === keys.length - 1, false)));
		});

		const history = this.loops.filter((loop) => inline(loop.from) !== loop);
		if (history.length > 0) rows.push({ text: "" });
		for (const loop of history) {
			const left = `${theme.fg("accent", "↺")} ${theme.fg("muted", `${LABEL.get(loop.from) ?? loop.from} → ${LABEL.get(loop.to) ?? loop.to}`)}`;
			rows.push({ text: fit(left, theme.fg("dim", `×${loop.count}`), w) });
		}
		return rows;
	}

	/** The tree view: the run as it grew, from the request down, centred in the panel. */
	private treeRows(w: number, frame: number, theme: Theme): Row[] {
		const nodes = this.tree;
		if (nodes.length === 0) return [{ text: theme.fg("dim", "◇ 你"), key: USER }, { text: "" }, { text: theme.fg("dim", "发出请求后，树从这里长出来。") }];
		const kids = nodes.map((): number[] => []);
		const depth: number[] = [];
		nodes.forEach((node, index) => {
			depth[index] = node.parent >= 0 ? depth[node.parent] + 1 : 0;
			if (node.parent >= 0) kids[node.parent].push(index);
		});
		const path = new Set<number>();
		for (let index = this.cursor; index >= 0; index = nodes[index].parent) path.add(index);
		const name = (index: number) => (nodes[index].key === USER ? truncateToWidth(this.get(USER).note || "你", 16, "…") : (LABEL.get(nodes[index].key) ?? nodes[index].key));
		const visits = (index: number) => (nodes[index].visit > 1 ? ` ×${nodes[index].visit}` : "");

		// Each subtree gets the columns of its widest row; a parent sits centred over its children.
		// When that does not fit, branches off the current path shrink to their glyphs; when even
		// that does not fit, the view keeps the node being worked on in the middle.
		const layout = (compact: boolean) => {
			const size = (index: number) => (compact && !path.has(index) ? 1 : 2 + visibleWidth(name(index)) + visibleWidth(visits(index)));
			const gap = compact ? 2 : TREE_GAP;
			const span: number[] = [];
			const col: number[] = [];
			const measure = (index: number): number => {
				const inner = kids[index].reduce((sum, child) => sum + measure(child), 0);
				span[index] = Math.max(size(index) + gap, inner);
				return span[index];
			};
			const place = (index: number, x: number) => {
				const children = kids[index];
				let at = x + Math.floor((span[index] - children.reduce((sum, child) => sum + span[child], 0)) / 2);
				for (const child of children) {
					place(child, at);
					at += span[child];
				}
				const first = children[0];
				const last = children.at(-1);
				col[index] = first !== undefined && last !== undefined ? Math.floor((col[first] + col[last]) / 2) : x + Math.floor(span[index] / 2);
			};
			measure(0);
			place(0, 0);
			const start = (index: number) => col[index] - Math.floor(size(index) / 2);
			const low = Math.min(...nodes.map((_, index) => start(index)));
			const high = Math.max(...nodes.map((_, index) => start(index) + size(index)));
			return { size, col, start, low, high };
		};
		let shape = layout(false);
		if (shape.high - shape.low > w) shape = layout(true);
		const span = shape.high - shape.low;
		const offset =
			span <= w
				? shape.low - Math.floor((w - span) / 2)
				: Math.min(Math.max(shape.col[Math.max(0, this.cursor)] - Math.floor(w / 2), shape.low), shape.high - w);

		const grid: Cell[][] = Array.from({ length: Math.max(...depth) * 2 + 1 }, () => Array.from({ length: w }, () => ({ ch: " " })));
		const put = (row: number, column: number, cell: Cell) => {
			if (column >= 0 && column < w && grid[row]) grid[row][column] = cell;
		};
		const write = (row: number, column: number, text: string, color: Color, bold = false) => {
			let x = column;
			for (const ch of text) {
				const cells = visibleWidth(ch);
				if (cells === 2 && (x < 0 || x >= w - 1)) {
					// A wide character cut by an edge of the panel.
					put(row, x, { ch: " " });
					put(row, x + 1, { ch: " " });
				} else {
					put(row, x, { ch, color, bold });
					if (cells === 2) put(row, x + 1, { ch: "" });
				}
				x += cells;
			}
		};

		// Edges: each joins a parent's column to its child's on the row between them.
		const links = new Map<string, { dirs: Set<string>; rank: number }>();
		const link = (row: number, column: number, dir: string, rank: number) => {
			const key = `${row}:${column}`;
			const cell = links.get(key) ?? { dirs: new Set<string>(), rank: 0 };
			cell.dirs.add(dir);
			cell.rank = Math.max(cell.rank, rank);
			links.set(key, cell);
		};
		nodes.forEach((node, index) => {
			if (node.parent < 0) return;
			const row = depth[index] * 2 - 1;
			const from = shape.col[node.parent] - offset;
			const to = shape.col[index] - offset;
			const rank = index === this.cursor && this.fresh ? 3 : path.has(index) ? 2 : 1;
			link(row, from, "u", rank);
			link(row, to, "d", rank);
			const [left, right] = from < to ? [from, to] : [to, from];
			for (let column = Math.max(left, -1); column <= Math.min(right, w); column++) {
				if (column > left) link(row, column, "l", rank);
				if (column < right) link(row, column, "r", rank);
			}
		});
		for (const [key, cell] of links) {
			const [row, column] = key.split(":").map(Number);
			const dirs = ["u", "d", "l", "r"].filter((dir) => cell.dirs.has(dir)).join("");
			put(row, column, { ch: BOX[dirs] ?? "│", color: EDGE[cell.rank] });
		}

		const hits = new Map<number, Omit<Hit, "y">[]>();
		nodes.forEach((node, index) => {
			const row = depth[index] * 2;
			const x = shape.start(index) - offset;
			const dead = !path.has(index);
			const state = node.key === USER ? this.get(USER).state : node.state;
			const [mark, color] = this.glyph(node.key, state, frame, dead);
			write(row, x, mark, color);
			if (shape.size(index) > 1) {
				const current = index === this.cursor && (state === "active" || state === "wait");
				write(row, x + 1, ` ${name(index)}`, current ? "accent" : dead || state === "idle" ? "dim" : state === "failed" ? "error" : "text", current);
				if (visits(index)) write(row, x + 2 + visibleWidth(name(index)), visits(index), "dim");
			}
			hits.set(row, [...(hits.get(row) ?? []), { x0: x, x1: x + shape.size(index), key: node.key }]);
		});

		const rows: Row[] = grid.map((line, row) => {
			let text = "";
			let run = "";
			let style: Cell | undefined;
			const flush = () => {
				if (run && style?.color) text += style.bold ? theme.bold(theme.fg(style.color, run)) : theme.fg(style.color, run);
				else text += run;
				run = "";
			};
			for (const cell of line) {
				if (cell.ch === "") continue;
				if (!style || cell.color !== style.color || cell.bold !== style.bold) {
					flush();
					style = cell;
				}
				run += cell.ch;
			}
			flush();
			return { text: text.replace(/ +$/, ""), hits: hits.get(row) };
		});

		const current = nodes[this.cursor];
		if (current) {
			const note = this.get(current.key).note;
			const title = `${current.key === USER ? "你" : (LABEL.get(current.key) ?? current.key)}${current.visit > 1 ? ` ×${current.visit}` : ""}`;
			rows.push({ text: "" }, { text: truncateToWidth(`${theme.fg("accent", "›")} ${theme.fg("text", title)}${note ? theme.fg("dim", ` · ${note}`) : ""}`, w, "…"), key: current.key });
		}
		return rows;
	}

	/** What the detail overlay shows for a step. */
	detail(key: string, theme: Theme): { title: string; lines: string[] } {
		const node = this.get(key);
		const lines: string[] = [];
		if (key === USER) lines.push(theme.fg("muted", node.note || "还没有请求。"));
		if (key === DONE && this.trail.length > 1) {
			lines.push(theme.fg("muted", `本轮轨迹：${this.trail.map((step) => LABEL.get(step) ?? step).join(" → ")}`));
			lines.push(theme.fg("dim", `工具调用 ${this.tools} 次${this.tokens > 0 ? ` · ${this.tokens} tokens` : ""}`));
		}
		for (const loop of this.loops.filter((item) => item.from === key || item.to === key)) {
			lines.push(theme.fg("accent", `↺ ${LABEL.get(loop.from)} → ${LABEL.get(loop.to)} ×${loop.count}`));
		}
		if (node.actions.length === 0 && key !== USER && key !== DONE) lines.push(theme.fg("dim", "本会话中这一步还没有工作。"));
		for (const action of [...node.actions].reverse()) {
			const mark = action.ok === false ? theme.fg("error", "✗") : theme.fg("success", "✓");
			const time = new Date(action.at).toTimeString().slice(0, 8);
			const tail = [action.summary, action.durationMs !== undefined && action.durationMs >= 1000 ? `${(action.durationMs / 1000).toFixed(1)}s` : ""]
				.filter(Boolean)
				.join(" · ");
			lines.push(`${theme.fg("dim", time)} ${mark} ${theme.fg("muted", action.verb)} ${action.target}${tail ? theme.fg("dim", `  ${tail}`) : ""}`);
		}
		return { title: LABEL.get(key) ?? key, lines };
	}
}
