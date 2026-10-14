import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Pack } from "../../packs/types.ts";
import type { History } from "../history.ts";
import { formatRedline, makeRedline, openFile } from "../redline.ts";

const SPEC_HELP = "c0003 指定一轮，c0001..c0003 指定一段，留空为最近一轮";

/**
 * Redlines on request: /redline for the user (opens the review page), and a tool for the model
 * when the user asks for a revision copy in chat. Only finished turns are recorded, so the
 * current turn's edits appear once it ends.
 */
export function registerRedline(pi: ExtensionAPI, getHistory: (cwd: string) => History, packs: Pack[]): void {
	pi.registerTool({
		name: "redline",
		label: "Redline",
		description: `为已结束的一轮或几轮修改生成修订稿：HTML 审阅页（逐块标出增删和原因，未改动的部分折叠），论文的 latexdiff PDF，专利的 Word 修订模式 DOCX（批注为修改原因）。spec：${SPEC_HELP}。本轮正在进行的修改要等本轮结束才会记录。`,
		promptSnippet: "为已结束的修改轮次生成修订稿（审阅页、latexdiff PDF、Word 修订 DOCX）",
		exposure: "model-only",
		parameters: Type.Object({
			spec: Type.Optional(Type.String({ description: SPEC_HELP })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await makeRedline(getHistory(ctx.cwd), packs, params.spec, signal);
			return {
				content: [{ type: "text", text: formatRedline(result, ctx.cwd) }],
				details: { label: result.label, page: result.page, outputs: result.outputs },
			};
		},
	});

	pi.registerCommand("redline", {
		description: `生成修订稿并打开审阅页：/redline [${SPEC_HELP}]`,
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) return ctx.ui.notify("agent 正在运行，等这一轮结束再生成修订稿。", "warning");
			if (ctx.hasUI) ctx.ui.notify("正在生成修订稿…", "info");
			try {
				const result = await makeRedline(getHistory(ctx.cwd), packs, args.trim() || undefined, ctx.signal);
				const text = formatRedline(result, ctx.cwd);
				if (ctx.hasUI) ctx.ui.notify(text, "info");
				else console.log(text);
				if (ctx.mode === "tui") openFile(result.page);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
			}
		},
	});
}
