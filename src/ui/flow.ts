import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { describeCall, describeResult, type ResultLike } from "./tool-rows.ts";

/**
 * Where the current run is, for the side panel: one vertical track of the steps a research-writing
 * run is made of. 2pi does not fix a workflow, so the track is the usual order of the steps for
 * the project's domains, and each tool call lights the step it belongs to.
 *
 * The part of the track already travelled in this pass is a solid line, what is still ahead is a
 * dotted one. When the model goes back to an earlier step (a failed check sends it back to the
 * draft, say), a loop is drawn on the left from where it left to where it went back, and the pass
 * starts again from there: the solid line ends at the step being redone, and the loop keeps the
 * earlier pass in view.
 *
 *     ◆ 你        把 paper.pdf 写成专利
 *     │
 *     ● 解析材料  已解析 12 页
 *     │
 *   ╭▸⠋ 撰写专利  ×2  patent/patent.json…
 *   │ ┊
 *   ╰─✗ 形式检查  2 错误 · 1 警告
 *     ┊
 *     ○ 生成文件
 *     ┊
 *     ◇ 完成
 *
 * Pure data plus rendering to strings, so it is tested without a terminal.
 */

export type NodeState = "idle" | "active" | "wait" | "done" | "failed";

interface StageSpec {
	key: string;
	label: string;
	/** Part of the usual track for these domains ("*": every project); others appear once used. */
	domains?: string[];
}

/** Every step, in the order a run usually goes through them. */
export const STAGES: StageSpec[] = [
	{ key: "ingest", label: "解析材料", domains: ["*"] },
	{ key: "research", label: "调研检索", domains: ["research"] },
	{ key: "evidence", label: "证据账本", domains: ["paper"] },
	{ key: "paper_draft", label: "撰写论文", domains: ["paper"] },
	{ key: "paper_build", label: "编译 PDF", domains: ["paper"] },
	{ key: "paper_check", label: "论文检查", domains: ["paper"] },
	{ key: "patent_draft", label: "撰写专利", domains: ["patent"] },
	{ key: "patent_check", label: "形式检查", domains: ["patent"] },
	{ key: "patent_build", label: "生成文件", domains: ["patent"] },
	{ key: "review", label: "核对渲染", domains: ["patent"] },
	{ key: "gate", label: "交付前检查", domains: ["*"] },
	{ key: "report", label: "修改说明" },
];

export const USER = "user";
export const DONE = "done";
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

/** A way back to an earlier step: drawn as a loop on the left of the track. */
interface Loop {
	from: string;
	to: string;
	count: number;
}

interface PlacedLoop {
	loop: Loop;
	/** Indexes in the route of the step returned to (top) and the step left (bottom). */
	top: number;
	bottom: number;
	lane: number;
}

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const MAX_ACTIONS = 60;
const MAX_LANES = 3;

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

export class FlowModel {
	private nodes = new Map<string, FlowNode>();
	private running = new Map<string, { key?: string; toolName: string; args: Record<string, unknown>; verb: string; target: string }>();
	private domains: string[] = [];
	/** Steps of the current run in the order they were reached. */
	private trail: string[] = [];
	/** Steps reached since the last loop back (the current pass). */
	private pass = new Set<string>();
	private loops: Loop[] = [];
	/** A dot moving along the last hand-off, one cell per frame. */
	private moving?: { from: string; to: string; back: boolean; position: number };
	private runNumber = 0;
	private runStarted?: number;
	private runEnded?: number;
	private activity = "";
	private tools = 0;
	private tokens = 0;
	private rowKeys: (string | undefined)[] = [];
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
	}

	/** The run reached `key`: extend the trail, and record a loop when it went back. */
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
		if (last) this.moving = { from: last, to: key, back, position: 0 };
		this.trail.push(key);
		this.get(key).visits += 1;
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
		this.moving = undefined;
		this.runStarted = this.now();
		this.runEnded = undefined;
		this.tools = 0;
		this.tokens = 0;
		this.activity = "思考中…";
		this.set(USER, "done", oneLine(prompt, 60));
		Object.assign(this.get(DONE), { state: "idle", note: "" });
		this.reach(USER);
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
		this.set(key, "active", target ? `${target}…` : "进行中…");
		this.reach(key);
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
		this.set("gate", report?.blocking ? "failed" : "done", report ? report.headline : "通过");
		node.actions.push({ verb: "检查", target: report ? report.headline : "通过", ok: !report?.blocking, at: this.now() });
		this.reach("gate");
		if (report?.fixing) this.activity = "按检查结果修改…";
	}

	setNetwork(status: NetworkStatus | undefined): void {
		this.network = status;
	}

	settled(outcome: "completed" | "aborted" | "error", error?: string): void {
		this.runEnded = this.now();
		this.running.clear();
		this.network = undefined;
		for (const node of this.nodes.values()) if (node.state === "active") node.state = outcome === "completed" ? "done" : "failed";
		const took = this.runStarted !== undefined ? clock(this.runEnded - this.runStarted) : "";
		if (outcome === "completed") this.set(DONE, "done", took ? `用时 ${took}` : "");
		else if (outcome === "aborted") this.set(DONE, "failed", "已中断");
		else this.set(DONE, "failed", error ? oneLine(error, 60) : "出错");
		if (this.get(USER).state === "wait") this.get(USER).state = "done";
		this.activity = outcome === "completed" ? "本轮完成" : outcome === "aborted" ? "已中断" : "出错";
		this.reach(DONE);
	}

	/** Move the hand-off dot one cell; whether anything still needs animating. */
	advance(): boolean {
		if (this.moving) {
			this.moving.position += 1;
			// Long enough for any path; render() also ends it when it runs off its path.
			if (this.moving.position > 80) this.moving = undefined;
		}
		return this.lively;
	}

	get lively(): boolean {
		return !!this.moving || !!this.network || [...this.nodes.values()].some((node) => node.state === "active" || node.state === "wait");
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

	/** The step drawn on line `y` of the last render (for clicks). */
	keyAt(y: number): string | undefined {
		return this.rowKeys[y];
	}

	/** Loops that fit the route, each on its own lane; short ones nearest the track. */
	private lanes(route: string[]): PlacedLoop[] {
		const placed: PlacedLoop[] = [];
		const spans = this.loops
			.map((loop) => ({ loop, top: route.indexOf(loop.to), bottom: route.indexOf(loop.from) }))
			.filter((span) => span.top >= 0 && span.bottom > span.top)
			.sort((a, b) => a.bottom - a.top - (b.bottom - b.top));
		for (const span of spans) {
			let lane = 0;
			while (placed.some((other) => other.lane === lane && other.top <= span.bottom && span.top <= other.bottom)) lane += 1;
			placed.push({ ...span, lane: Math.min(lane, MAX_LANES - 1) });
		}
		return placed;
	}

	private glyph(node: FlowNode, frame: number, theme: Theme, faded: boolean): string {
		if (node.key === USER) {
			if (node.state === "wait") return frame % 16 < 10 ? theme.fg("accent", "?") : theme.fg("dim", "?");
			return node.state === "idle" ? theme.fg("dim", "◇") : theme.fg(faded ? "dim" : "accent", "◆");
		}
		if (node.key === DONE) {
			if (node.state === "done") return theme.fg(faded ? "dim" : "success", "◆");
			return node.state === "failed" ? theme.fg("error", "✗") : theme.fg("dim", "◇");
		}
		switch (node.state) {
			case "active":
				return theme.fg("accent", SPIN[Math.floor(frame / 2) % SPIN.length] ?? "⠋");
			case "done":
				return theme.fg(faded ? "dim" : "success", "●");
			case "failed":
				return theme.fg(faded ? "dim" : "error", "✗");
			default:
				return theme.fg("dim", "○");
		}
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

	/** The whole panel: status, the track, the plan. Every line is at most `width` cells. */
	render(width: number, frame: number, theme: Theme): string[] {
		const w = Math.max(20, width);
		const route = this.route();
		const lanes = this.lanes(route);
		const laneCount = lanes.length > 0 ? Math.max(...lanes.map((item) => item.lane)) + 1 : 0;
		// Columns: two per lane (its vertical line and a connector), then the track itself.
		const track = laneCount * 2 + 1;
		const height = route.length * 2 - 1;
		const grid = Array.from({ length: height }, () => Array.from({ length: track + 1 }, () => ({ ch: " ", style: "" })));
		const at = (row: number, col: number) => grid[row]?.[col];
		const put = (row: number, col: number, ch: string, style: string) => {
			const target = at(row, col);
			if (target) Object.assign(target, { ch, style });
		};

		// The track: solid down to the furthest step of the current pass, dotted after it.
		const furthest = Math.max(0, ...route.map((key, index) => (this.pass.has(key) ? index : 0)));
		for (let index = 0; index < route.length - 1; index++) {
			const travelled = index + 1 <= furthest;
			put(index * 2 + 1, track, travelled ? "│" : "┊", travelled ? "track" : "future");
		}

		// Loops: from the step the run left (bottom) up to the step it went back to (top).
		for (const { top, bottom, lane } of lanes) {
			const col = (laneCount - 1 - lane) * 2;
			const topRow = top * 2;
			const bottomRow = bottom * 2;
			for (let row = topRow + 1; row < bottomRow; row++) put(row, col, at(row, col)?.ch === "─" ? "┼" : "│", "loop");
			for (let c = col + 1; c < track; c++) {
				put(topRow, c, c === track - 1 ? "▸" : at(topRow, c)?.ch === "│" ? "┼" : "─", "loop");
				put(bottomRow, c, at(bottomRow, c)?.ch === "│" ? "┼" : "─", "loop");
			}
			put(topRow, col, "╭", "loop");
			put(bottomRow, col, "╰", "loop");
		}

		// The hand-off dot: along the track, or round the loop when the run went back.
		let dot: [number, number] | undefined;
		if (this.moving) {
			dot = this.dotPath(route, lanes, laneCount, track)[this.moving.position];
			if (!dot) this.moving = undefined;
		}

		const paint = (style: string, ch: string) =>
			style === "track" ? theme.fg("muted", ch) : style === "future" ? theme.fg("dim", ch) : style === "loop" ? theme.fg("accent", ch) : ch;
		const visitsText = (key: string) => (this.get(key).visits > 1 ? ` ×${this.get(key).visits}` : "");
		const labelWidth = Math.max(...route.map((key) => visibleWidth(`${LABEL.get(key) ?? key}${visitsText(key)}`)));
		const header = this.header(w, frame, theme);
		const lines: string[] = [...header, ""];
		this.rowKeys = [...header.map(() => undefined), undefined];

		for (let row = 0; row < height; row++) {
			const key = row % 2 === 0 ? route[row / 2] : undefined;
			const cells = (grid[row] ?? []).map((item, col) => (dot && dot[0] === row && dot[1] === col ? theme.fg("accent", "•") : paint(item.style, item.ch)));
			if (!key) {
				lines.push(truncateToWidth(cells.join("").replace(/\s+$/, ""), w, ""));
				this.rowKeys.push(undefined);
				continue;
			}
			const node = this.get(key);
			// Steps from an earlier run, or from an earlier pass of this one, recede.
			const faded = node.run !== this.runNumber || (key !== USER && key !== DONE && !this.pass.has(key));
			if (!(dot && dot[0] === row && dot[1] === track)) cells[track] = this.glyph(node, frame, theme, faded);
			const current = node.state === "active" || node.state === "wait";
			const name = LABEL.get(key) ?? key;
			const label = current
				? theme.bold(theme.fg("accent", name))
				: node.state === "failed" && !faded
					? theme.fg("error", name)
					: node.state === "idle" || faded
						? theme.fg("dim", name)
						: theme.fg("text", name);
			const visits = visitsText(key) ? theme.fg("dim", visitsText(key)) : "";
			const note = !node.note
				? ""
				: current
					? theme.fg("accent", node.note)
					: node.state === "failed" && !faded
						? theme.fg("error", node.note)
						: theme.fg("dim", node.note);
			const head = `${cells.join("")} ${pad(`${label}${visits}`, labelWidth)}`;
			lines.push(truncateToWidth(note ? `${head}  ${note}` : head, w, "…"));
			this.rowKeys.push(key);
		}

		const plan = this.planLines(w, theme);
		if (plan.length > 0) {
			lines.push("", ...plan);
			this.rowKeys.push(undefined, ...plan.map(() => undefined));
		}
		lines.push("", truncateToWidth(theme.fg("dim", "点击步骤看记录 · F2 隐藏"), w, ""));
		return lines;
	}

	/** Grid cells the hand-off dot passes: along the track, or round a loop. */
	private dotPath(route: string[], lanes: PlacedLoop[], laneCount: number, track: number): [number, number][] {
		if (!this.moving) return [];
		const from = route.indexOf(this.moving.from);
		const to = route.indexOf(this.moving.to);
		if (from < 0 || to < 0) return [];
		const cells: [number, number][] = [];
		const loop = this.moving.back ? lanes.find((item) => item.top === to && item.bottom === from) : undefined;
		if (loop) {
			const col = (laneCount - 1 - loop.lane) * 2;
			for (let c = track - 1; c > col; c--) cells.push([from * 2, c]);
			for (let row = from * 2; row >= to * 2; row--) cells.push([row, col]);
			for (let c = col + 1; c < track; c++) cells.push([to * 2, c]);
			return cells;
		}
		const step = to >= from ? 1 : -1;
		for (let row = from * 2 + step; row !== to * 2; row += step) cells.push([row, track]);
		return cells;
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
