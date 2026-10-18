import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir, keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, colorToRgb, type TUI } from "@earendil-works/pi-tui";
import { AGENT_ROOT, env } from "../core/config.ts";
import type { GateOutcome } from "../core/gate.ts";
import type { ReconnectStatus } from "../core/reconnect.ts";
import { showPlanWidget } from "../core/tools/update-plan.ts";
import { type BannerInfo, bannerLines } from "./banner.ts";
import { FlowModel, type FlowView } from "./flow.ts";
import { gateHeadline, registerGateMessage } from "./gate-message.ts";
import { readPrefs, SplitView, writePrefs } from "./split.ts";
import { registerCompactToolRows } from "./tool-rows.ts";

/**
 * 2pi's terminal look: the startup header, compact tool rows, one-line check reports, a quiet
 * thinking label, and (fullscreen mode, on by default) the split view with the flow panel on the
 * right. TWOPI_CLASSIC_UI=1 keeps pi's own rendering; TWOPI_SPLIT=0 keeps one column.
 */

export interface UiOptions {
	/** The project's domains, e.g. ["paper", "research"]. */
	domains(cwd: string): string[];
}

/** What the rest of 2pi tells the UI about. */
export interface UiHandle {
	readonly flow: FlowModel;
	/** The side panel is on screen (so the plan needs no widget above the editor). */
	panelVisible(): boolean;
	planChanged(): void;
	gate(outcome: GateOutcome): void;
	network(status: ReconnectStatus | undefined): void;
}

function version(): string {
	try {
		return (JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "";
	} catch {
		return "";
	}
}

const OPENING_MS = 1100;

/**
 * The startup header: the mark, name and version, model, directory. In fullscreen mode the book
 * opens once when 2pi starts (about a second); after that the lines are cached per width.
 */
class Header implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly info: () => BannerInfo;
	private started?: number;
	private timer?: ReturnType<typeof setInterval>;
	private cache?: { key: string; lines: string[] };

	constructor(tui: TUI, theme: Theme, info: () => BannerInfo, animate: boolean) {
		this.tui = tui;
		this.theme = theme;
		this.info = info;
		if (!animate) this.started = Number.NEGATIVE_INFINITY;
	}

	private opening(): number {
		this.started ??= Date.now();
		const progress = Math.min(1, (Date.now() - this.started) / OPENING_MS);
		if (progress < 1 && !this.timer) {
			this.timer = setInterval(() => this.tui.requestRender(), 40);
			this.timer.unref?.();
		} else if (progress >= 1) {
			this.dispose();
		}
		return progress;
	}

	render(width: number): string[] {
		const { theme } = this;
		const opening = this.opening();
		const info = this.info();
		const key = `${width}|${theme.appearance}|${info.model}|${info.hints}`;
		if (opening >= 1 && this.cache?.key === key) return this.cache.lines;
		const { r, g, b } = colorToRgb(theme.colors.text);
		const lines = bannerLines(
			width,
			info,
			{
				mode: theme.getColorMode(),
				appearance: theme.appearance,
				foreground: [r, g, b],
				bold: (text) => theme.bold(text),
				dim: (text) => theme.fg("dim", text),
			},
			opening,
		);
		if (opening >= 1) this.cache = { key, lines };
		return lines;
	}

	invalidate(): void {
		this.cache = undefined;
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}
}

/** "superaihub/gpt-6.1-sol · xhigh", or how to get a model. */
export function modelLine(model: { provider: string; id: string } | undefined, thinking: string | undefined): string {
	if (!model) return "还没有可用的模型 · /login 登录或在 models.json 中配置";
	return `${model.provider}/${model.id}${thinking && thinking !== "off" ? ` · ${thinking}` : ""}`;
}

/** The working directory with the home directory shortened to ~. */
export function shortDirectory(cwd: string): string {
	const home = homedir();
	const inside = cwd.toLowerCase().startsWith(home.toLowerCase()) && /^[\\/]?$/.test(cwd.slice(home.length, home.length + 1));
	return (inside ? `~${cwd.slice(home.length)}` : cwd).replace(/\\/g, "/");
}

function hints(theme: Theme, split: boolean): string {
	const dot = theme.fg("dim", " · ");
	return [
		theme.fg("dim", "/init 建立项目"),
		keyHint("app.interrupt", "中断"),
		keyHint("app.tools.expand", "展开输出"),
		...(split ? [theme.fg("dim", "F2 流程面板")] : []),
		theme.fg("dim", "/changes 看修改"),
	].join(dot);
}

const NOOP: Omit<UiHandle, "flow"> = { panelVisible: () => false, planChanged() {}, gate() {}, network() {} };

export function installUi(pi: ExtensionAPI, options: UiOptions): UiHandle {
	const flow = new FlowModel();
	if (env("CLASSIC_UI")) return { flow, ...NOOP };
	registerCompactToolRows(pi);
	registerGateMessage(pi);

	let split: SplitView | undefined;
	// The book opens once per process, not again when pi rebuilds the header.
	let opened = false;
	let model: { provider: string; id: string } | undefined;
	let thinking: string | undefined;
	let lastCtx: ExtensionContext | undefined;
	let lastError: string | undefined;
	const splitAllowed = env("SPLIT") !== "0";
	const refresh = () => split?.refresh();

	const replacePlanWidget = () => {
		if (lastCtx) showPlanWidget(lastCtx, flow.plan, { shownElsewhere: () => split?.visible ?? false });
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		lastCtx = ctx;
		ctx.ui.setHiddenThinkingLabel("思考中");
		model = ctx.model;
		thinking = ctx.thinkingLevel;
		const directory = shortDirectory(ctx.cwd);
		const agentVersion = version();
		const domains = options.domains(ctx.cwd);
		flow.setDomains(domains);
		ctx.ui.setHeader((tui, theme) => {
			const fullscreen = tui.mode === "fullscreen";
			if (fullscreen && splitAllowed && !split) {
				const agentDir = getAgentDir();
				split = new SplitView({
					tui,
					flow,
					theme: () => ctx.ui.theme,
					prefs: readPrefs(agentDir),
					savePrefs: (prefs) => writePrefs(agentDir, prefs),
					onVisibilityChange: replacePlanWidget,
				});
				split.start();
			}
			const animate = tui.mode === "fullscreen" && !opened;
			opened = true;
			return new Header(
				tui,
				theme,
				() => ({
					version: agentVersion,
					model: modelLine(model, thinking),
					directory,
					domains: domains.join("、"),
					hints: hints(theme, !!split),
				}),
				animate,
			);
		});
	});

	pi.on("model_select", (event) => {
		model = event.model;
	});
	pi.on("thinking_level_select", (event) => {
		thinking = event.level;
	});

	pi.on("session_shutdown", () => {
		split?.dispose();
		split = undefined;
	});

	pi.on("before_agent_start", (event, ctx) => {
		lastCtx = ctx;
		lastError = undefined;
		flow.setDomains(options.domains(ctx.cwd));
		flow.startRun(event.prompt);
		refresh();
		return undefined;
	});
	pi.on("turn_start", () => {
		flow.turnStart();
		refresh();
	});
	pi.on("message_update", (event) => {
		const kind = event.assistantMessageEvent.type;
		if (kind === "thinking_start" || kind === "thinking_delta") flow.assistantActivity("thinking");
		else if (kind === "text_start" || kind === "text_delta") flow.assistantActivity("text");
	});
	pi.on("message_end", (event) => {
		const message = event.message as { role: string; stopReason?: string; errorMessage?: string; usage?: { totalTokens?: number } };
		if (message.role !== "assistant") return;
		if (message.usage?.totalTokens) flow.addUsage(message.usage.totalTokens);
		lastError = message.stopReason === "error" ? (message.errorMessage ?? "出错") : undefined;
		refresh();
	});
	pi.on("tool_execution_start", (event, ctx) => {
		flow.toolStart(event.toolCallId, event.toolName, (event.args ?? {}) as Record<string, unknown>, ctx.cwd);
		refresh();
	});
	pi.on("tool_execution_end", (event) => {
		flow.toolEnd(event.toolCallId, event.result, event.isError, event.durationMs);
		refresh();
	});
	pi.on("ui_prompt_start", (event) => {
		flow.waitingForUser(true, event.title);
		refresh();
	});
	pi.on("ui_prompt_end", () => {
		flow.waitingForUser(false);
		refresh();
	});
	pi.on("agent_settled", (event) => {
		flow.settled(event.aborted ? "aborted" : lastError ? "error" : "completed", lastError);
		refresh();
	});

	pi.registerShortcut("f2", {
		description: "显示或隐藏右侧流程面板",
		handler: (ctx) => togglePanel(ctx),
	});
	pi.registerShortcut("f3", {
		description: "流程面板在步骤轨道与树状图之间切换",
		handler: (ctx) => switchView(ctx),
	});

	const noPanel = (ctx: ExtensionContext) =>
		ctx.ui.notify(
			splitAllowed ? "流程面板需要全屏界面：在 /settings 中把 TUI mode 设为 fullscreen 后重新启动。" : "流程面板已被 TWOPI_SPLIT=0 关闭。",
			"info",
		);

	const togglePanel = (ctx: ExtensionContext, enabled?: boolean) => {
		if (!split) return noPanel(ctx);
		split.setEnabled(enabled ?? !split.prefs.enabled);
		ctx.ui.notify(split.prefs.enabled ? "已显示流程面板（F2 或 /panel off 隐藏）" : "已隐藏流程面板（F2 或 /panel on 显示）", "info");
	};

	/** The track or the tree; showing either brings a hidden panel back. */
	const switchView = (ctx: ExtensionContext, view?: FlowView) => {
		if (!split) return noPanel(ctx);
		if (!split.prefs.enabled) split.setEnabled(true);
		split.setView(view ?? (split.prefs.view === "tree" ? "track" : "tree"));
	};

	pi.registerCommand("panel", {
		description: "右侧流程面板：/panel 切换，/panel on|off，/panel track|tree 轨道或树状图，/panel 65 把左栏设为 65% 宽",
		getArgumentCompletions: (prefix) =>
			["on", "off", "track", "tree", "70", "60"].filter((value) => value.startsWith(prefix.trim())).map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const value = args.trim();
			if (!value) return togglePanel(ctx);
			if (value === "on" || value === "off") return togglePanel(ctx, value === "on");
			if (value === "track" || value === "tree") return switchView(ctx, value);
			const percent = Number(value.replace(/%$/, ""));
			if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
				ctx.ui.notify("用法：/panel [on|off|track|tree|左栏宽度百分比，如 70]", "warning");
				return;
			}
			if (!split) return togglePanel(ctx);
			if (!split.prefs.enabled) split.setEnabled(true);
			split.setRatio(percent);
			ctx.ui.notify(`左栏宽度：${Math.round(split.prefs.ratio * 100)}%（也可以直接拖动中间的分隔线）`, "info");
		},
	});

	return {
		flow,
		panelVisible: () => split?.visible ?? false,
		planChanged: refresh,
		gate: (outcome) => {
			if (!outcome.text) {
				flow.gate(undefined);
			} else {
				const { parts } = gateHeadline(outcome.text);
				const headline = parts.length > 0 ? parts.join(" · ") : outcome.needsFix ? "有待处理项" : "无阻断问题";
				flow.gate({ headline: outcome.fixing ? `${headline} · 自动修复` : headline, blocking: outcome.needsFix, fixing: outcome.fixing });
			}
			refresh();
		},
		network: (status) => {
			flow.setNetwork(status);
			refresh();
		},
	};
}
