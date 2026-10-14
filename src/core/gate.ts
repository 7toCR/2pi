import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GateReport, Pack } from "../packs/types.ts";
import { cleanPathArg } from "./paths.ts";
import type { CoreState } from "./state.ts";

/** Automatic fix rounds per user prompt, so the gate can never loop. */
export const MAX_AUTO_ROUNDS = 2;
const IMAGE = /\.(png|jpe?g)$/i;
export const GATE_MESSAGE = "2pi-gate";

/** Everything the packs still consider unverified by the model. */
export function pendingWork(packs: Pack[], core: CoreState): string[] {
	return packs.flatMap((pack) => pack.pendingWork(core));
}

/** What the gate decided at the end of a turn, for the UI: no text means nothing to report. */
export interface GateOutcome {
	text?: string;
	needsFix: boolean;
	/** A fix round starts. */
	fixing: boolean;
}

/**
 * Verify before delivering, enforced by the harness instead of a fixed workflow. When the model is
 * about to stop, each pack checks what changed in this turn (compile, run its checker) and lists
 * what only the model can verify (e.g. drawings it has not looked at). Errors or open items start
 * a fix round, at most MAX_AUTO_ROUNDS per user prompt; after that they are reported, not hidden.
 */
export function installGate(
	pi: ExtensionAPI,
	core: CoreState,
	packs: Pack[],
	/** Open items the core itself tracks for the project (e.g. an unexplained change). */
	corePending: (cwd: string) => string[] = () => [],
	onOutcome: (outcome: GateOutcome) => void = () => {},
): void {
	pi.on("before_agent_start", () => {
		core.nudges = 0;
		core.lastNudge = "";
	});

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName === "read" && typeof event.input.path === "string" && IMAGE.test(event.input.path)) {
			core.markViewed(resolve(ctx.cwd, cleanPathArg(event.input.path)));
		}
		return undefined;
	});

	// Pages seen through pdf_preview count as seen: the PDF itself is marked.
	pi.on("tool_result", (event) => {
		const pdf = (event.details as { pdf?: unknown } | undefined)?.pdf;
		if (event.toolName === "pdf_preview" && !event.isError && typeof pdf === "string") core.markViewed(pdf);
		return undefined;
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "completed") return undefined;
		const reports: GateReport[] = [];
		for (const pack of packs) {
			try {
				const report = await pack.autoCheck?.(ctx.cwd, core, ctx.signal);
				if (report) reports.push(report);
			} catch (error) {
				reports.push({
					text: `${pack.id} 检查未能运行：${error instanceof Error ? error.message : String(error)}`,
					needsFix: false,
				});
			}
		}
		const reminders = [...pendingWork(packs, core), ...corePending(ctx.cwd)];
		if (reports.length === 0 && reminders.length === 0) {
			onOutcome({ needsFix: false, fixing: false });
			return undefined;
		}

		const body = [
			...reports.map((report) => report.text),
			...(reminders.length > 0 ? [["还需要你亲自完成：", ...reminders.map((item) => `- ${item}`)].join("\n")] : []),
		].join("\n\n");
		// An unchanged list of open items is not repeated: the model may stop after explaining itself.
		if (reports.length === 0 && body === core.lastNudge) return undefined;
		core.lastNudge = body;

		const needsFix = reports.some((report) => report.needsFix) || reminders.length > 0;
		const cont = needsFix && core.nudges < MAX_AUTO_ROUNDS;
		// Print mode outputs the session's last message only when it is the model's answer: a report
		// that starts no fix round would replace the answer with nothing.
		if (!cont && ctx.mode === "print") return undefined;
		if (cont) core.nudges += 1;
		onOutcome({ text: body, needsFix, fixing: cont });
		const footer = !needsFix
			? "没有阻断性问题。WARN 逐条处理：能改的修改，误报的在说明中写明理由。"
			: cont
				? `自动修复轮 ${core.nudges}/${MAX_AUTO_ROUNDS}：处理上面的问题后再结束本轮，结束时会再次检查。错误未解决时不要告诉用户稿件已无问题；如果你在等待用户确认，或已在说明中写明无法处理的原因，可以直接简短回复。`
				: `本次请求的 ${MAX_AUTO_ROUNDS} 轮自动修复已用完，上面的问题仍未解决，交付时必须如实说明。`;
		return {
			entries: [
				{
					type: "custom_message",
					customType: GATE_MESSAGE,
					content: ["[交付前检查]", body, footer].join("\n\n"),
					display: true,
					details: { needsFix, round: core.nudges },
				},
			],
			continue: cont,
		};
	});
}
