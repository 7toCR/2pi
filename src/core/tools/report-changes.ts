import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { History } from "../history.ts";
import { describeBlockChanges } from "../review.ts";

/**
 * The model's account of a turn: one summary sentence and the reason behind each notable change.
 * Reasons are attached to the changed blocks they name and shown in /changes, the review page and
 * the redline documents, so a reviewer sees what changed and why in one place.
 */
export function registerReportChangesTool(pi: ExtensionAPI, getHistory: (cwd: string) => History): void {
	pi.registerTool({
		name: "report_changes",
		label: "Report Changes",
		description:
			"说明本轮对稿件做了什么修改、为什么。summary 一句话概括；reasons 写关键修改的原因：target 优先写被改的块（如\"权利要求1\"\"说明书·具体实施方式 第3段\"\"Methods 第2段\"\"证据账本 E12\"）；一个原因适用于一节或一个文件的全部改动时可以写节名（如\"说明书·发明内容\"）或文件路径，其中原因不同的块再单独写，越具体的原因越优先。生成文件（DOCX、PDF、预览图）不用写原因。工具返回本轮所有被修改的块和各自的原因，名称没对上的可以再调用一次补充。",
		promptSnippet: "说明本轮修改了哪些块、为什么（显示在修改记录、审阅页与修订稿中）",
		promptGuidelines: ["修改了论文或专利稿件的轮次，在交付消息之前调用 report_changes：一句总结，加上每处关键修改的原因"],
		exposure: "model-only",
		parameters: Type.Object({
			summary: Type.Optional(Type.String({ description: "本轮修改的一句话总结；再次调用只为补充原因时省略" })),
			reasons: Type.Optional(
				Type.Array(
					Type.Object({
						target: Type.String({ description: "被修改的块：块标题、块编号或文件路径" }),
						why: Type.String({ description: "为什么这样改（依据：用户要求、检查结果、论文出处等）" }),
					}),
				),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { changes, unmatched } = getHistory(ctx.cwd).report(params.summary, params.reasons ?? []);
			const withoutReason = changes.filter((change) => !change.why);
			const lines = [
				changes.length > 0 ? `本轮修改了 ${changes.length} 处：` : "本轮还没有检测到对文本文件的修改。",
				...describeBlockChanges(changes),
			];
			if (unmatched.length > 0) {
				lines.push("", "以下原因没有对上任何被修改的块（会作为本轮备注保留）：", ...unmatched.map((reason) => `- ${reason.target}：${reason.why}`));
			}
			if (withoutReason.length > 0 && withoutReason.length < changes.length) {
				lines.push("", `还有 ${withoutReason.length} 处修改没有写原因；重要的可以再调用一次补充（target 用上面列出的块名）。`);
			}
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { changes: changes.length, unmatched: unmatched.length },
			};
		},
	});
}
