import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { planWidget } from "../../ui/widgets.ts";

/** Codex's `update_plan`: the model owns the plan; the agent only displays and persists it. */

const STATUSES = ["pending", "in_progress", "completed"] as const;

export interface PlanItem {
	step: string;
	status: (typeof STATUSES)[number];
}

export interface PlanDetails {
	explanation?: string;
	plan: PlanItem[];
}

const MARK: Record<PlanItem["status"], string> = { pending: "○", in_progress: "▶", completed: "✓" };

export function renderPlan(plan: PlanItem[]): string[] {
	const done = plan.filter((item) => item.status === "completed").length;
	return [`计划 ${done}/${plan.length}`, ...plan.map((item) => `${MARK[item.status]} ${item.step}`)];
}

/** The latest plan on the active branch, so /tree and resume show the right plan. */
export function latestPlan(ctx: ExtensionContext): PlanDetails | undefined {
	let latest: PlanDetails | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "toolResult" && message.toolName === "update_plan" && !message.isError && message.details) {
			latest = message.details as unknown as PlanDetails;
		}
	}
	return latest;
}

export interface PlanDisplay {
	/** Receives every plan update (the flow panel shows it). */
	onPlan?(plan: PlanItem[]): void;
	/** The plan is on screen elsewhere, so the widget above the editor is not needed. */
	shownElsewhere?(): boolean;
}

/** Show the plan above the editor unless the side panel already shows it. */
export function showPlanWidget(ctx: ExtensionContext, plan: PlanItem[] | undefined, display: PlanDisplay = {}): void {
	if (!ctx.hasUI) return;
	const active = plan && plan.length > 0 && plan.some((item) => item.status !== "completed");
	if (!active || (ctx.mode === "tui" && display.shownElsewhere?.())) return ctx.ui.setWidget("2pi-plan", undefined);
	if (ctx.mode === "tui") ctx.ui.setWidget("2pi-plan", planWidget(plan));
	else ctx.ui.setWidget("2pi-plan", renderPlan(plan));
}

export function registerPlanTool(pi: ExtensionAPI, display: PlanDisplay = {}): void {
	const showPlan = (ctx: ExtensionContext, plan: PlanItem[] | undefined) => {
		display.onPlan?.(plan ?? []);
		showPlanWidget(ctx, plan, display);
	};

	pi.registerTool({
		name: "update_plan",
		label: "Plan",
		description:
			"更新任务计划。提供完整的步骤列表（每次都给全量），每步带状态 pending / in_progress / completed，同一时间最多一个 in_progress。可附一句 explanation 说明为何调整。简单问答不需要计划；不要只列一步。",
		exposure: "model-only",
		promptSnippet: "维护你自己的任务计划（多步任务开始时写出，每完成一步更新）",
		parameters: Type.Object({
			explanation: Type.Optional(Type.String({ description: "本次更新的简短说明" })),
			plan: Type.Array(
				Type.Object({
					step: Type.String({ description: "步骤内容" }),
					status: StringEnum(STATUSES, { description: "步骤状态" }),
				}),
				{ description: "完整的步骤列表" },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const inProgress = params.plan.filter((item) => item.status === "in_progress").length;
			if (inProgress > 1) throw new Error("同一时间最多只能有一个 in_progress 步骤。");
			const details: PlanDetails = { explanation: params.explanation, plan: params.plan };
			showPlan(ctx, params.plan);
			const done = params.plan.filter((item) => item.status === "completed").length;
			return { content: [{ type: "text", text: `计划已更新（${done}/${params.plan.length} 完成）。` }], details };
		},
	});

	const restore = (_event: unknown, ctx: ExtensionContext) => showPlan(ctx, latestPlan(ctx)?.plan);
	pi.on("session_start", restore);
	pi.on("session_tree", restore);

	pi.registerCommand("plan", {
		description: "查看当前任务计划",
		handler: async (_args, ctx) => {
			const plan = latestPlan(ctx);
			if (!plan || plan.plan.length === 0) {
				ctx.ui.notify("当前没有计划。", "info");
				return;
			}
			ctx.ui.notify([...renderPlan(plan.plan), ...(plan.explanation ? [`说明：${plan.explanation}`] : [])].join("\n"), "info");
		},
	});
}
