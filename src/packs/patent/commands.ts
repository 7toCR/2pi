import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { cleanPathArg, splitArgs } from "../../core/paths.ts";

const MODES = ["direct", "human-in-loop", "text-only", "claims-only"] as const;

function send(pi: ExtensionAPI, ctx: ExtensionCommandContext, text: string): void {
	pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
}

function requireFile(ctx: ExtensionCommandContext, path: string | undefined, usage: string): string | undefined {
	if (!path) {
		ctx.ui.notify(usage, "warning");
		return undefined;
	}
	if (!existsSync(resolve(ctx.cwd, cleanPathArg(path)))) {
		ctx.ui.notify(`找不到文件：${path}`, "error");
		return undefined;
	}
	return path;
}

export function registerPatentCommands(pi: ExtensionAPI): void {
	pi.registerCommand("patent", {
		description: "把论文转写为专利申请初稿：/patent <论文路径> [direct|human-in-loop|text-only|claims-only]",
		// After the paper path, offer the drafting modes.
		getArgumentCompletions: (prefix) =>
			splitArgs(prefix).length === 1 && prefix.endsWith(" ")
				? MODES.map((mode) => ({ value: `${prefix}${mode}`, label: mode }))
				: null,
		handler: async (args, ctx) => {
			const parts = splitArgs(args);
			const mode = MODES.find((value) => value === parts[parts.length - 1]);
			const path = requireFile(ctx, mode ? parts.slice(0, -1).join(" ") : parts.join(" "), "用法：/patent <论文路径> [模式]");
			if (!path) return;
			send(
				pi,
				ctx,
				`请把论文 ${path} 转写为中国发明专利申请初稿，撰写模式：${mode ?? "direct"}。交付 DOCX/PDF 与撰写说明。`,
			);
		},
	});

	pi.registerCommand("review", {
		description: "审查已有专利草稿：/review <草稿 JSON/DOCX> [论文路径]",
		handler: async (args, ctx) => {
			const [draft, paper] = splitArgs(args);
			const draftPath = requireFile(ctx, draft, "用法：/review <草稿> [论文路径]");
			if (!draftPath) return;
			if (paper && !requireFile(ctx, paper, "")) return;
			send(
				pi,
				ctx,
				`请以 review 模式审查专利草稿 ${draftPath}${paper ? `，对照论文 ${paper}` : ""}：运行自检，并按 quality-checklist 逐条核对权利要求特征与论文的对应关系、充分公开与支持关系。先给出按严重程度排序的问题清单；除非我要求，不要直接改写草稿。`,
			);
		},
	});
}
