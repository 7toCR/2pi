import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Codex's `request_user_input`, for human-in-loop drafting. */

const OTHER = "其他（手动输入）";

const NO_ANSWER =
	"请按最合理且保守的假设继续，并把这个问题原样写入 notes.handover，交由用户或专利代理师确认。";

export function registerAskUserTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"向用户提一个问题并等待回答。仅用于：human-in-loop 模式下确认公开状态、发明点、权利要求规划；或缺少会改变权利要求1的关键信息且无法从论文推断。尽量提供选项。非交互模式下不会得到回答。",
		exposure: "model-only",
		promptSnippet: "向用户提问（仅在必要时，一次问全并给出选项）",
		parameters: Type.Object({
			question: Type.String({ description: "问题，写清楚需要用户决定什么以及为什么" }),
			options: Type.Optional(Type.Array(Type.String(), { description: "候选答案；用户也可以选择手动输入" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: `当前为非交互模式，无法向用户提问。${NO_ANSWER}` }],
					details: { answered: false },
				};
			}
			const options = params.options?.filter((option) => option.trim()) ?? [];
			let answer: string | undefined;
			if (options.length > 0) {
				answer = await ctx.ui.select(params.question, [...options, OTHER]);
				if (answer === OTHER) answer = await ctx.ui.input(params.question);
			} else {
				answer = await ctx.ui.input(params.question);
			}
			if (answer === undefined || !answer.trim()) {
				return {
					content: [{ type: "text", text: `用户没有回答。${NO_ANSWER}` }],
					details: { answered: false },
				};
			}
			return { content: [{ type: "text", text: `用户回答：${answer.trim()}` }], details: { answered: true, answer } };
		},
	});
}
