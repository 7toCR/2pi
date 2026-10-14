import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AGENT_ROOT } from "../config.ts";
import { cleanPathArg, slash } from "../paths.ts";
import { STATE_DIR } from "../project.ts";
import { runPython } from "../python.ts";
import type { CoreState } from "../state.ts";

interface IngestResult {
	source: string;
	backend: string;
	text_path: string;
	pages: number;
	lines: number;
	chars: number;
	page_images: Array<{ page: number; path: string }>;
	figure_files: string[];
	outline: Array<{ line: number; page?: number | null; title: string }>;
	captions: Array<{ kind: string; label: string; line: number; page?: number | null; caption: string }>;
	disclosure_clues: Array<{ kind: string; line: number; page?: number | null; text: string }>;
	warnings: string[];
}

const at = (item: { line: number; page?: number | null }): string =>
	item.page ? `p${item.page} L${item.line}` : `L${item.line}`;

export function formatIngest(result: IngestResult): string {
	const lines = [
		`已解析：${slash(result.source)}（${result.backend}，${result.pages} 页，${result.lines} 行，约 ${result.chars} 字符）`,
		`全文：${slash(result.text_path)}${result.pages > 1 ? "（每页以 [[page N]] 行开头）" : ""}。请用 read 分段读完全文，包括附录。`,
	];
	if (result.page_images.length > 0) {
		lines.push(
			`页面图像 ${result.page_images.length} 张（第 ${result.page_images.map((item) => item.page).join("、")} 页）：`,
			...result.page_images.map((item) => `- ${slash(item.path)}`),
			"方法图、流程图、表格以页面图像为准：用 read 打开对应 PNG 查看。需要其他页时用 pages 参数重新渲染。",
		);
	}
	if (result.figure_files.length > 0) {
		lines.push("原文插图：", ...result.figure_files.map((path) => `- ${slash(path)}`));
	}
	if (result.captions.length > 0) {
		lines.push("图/表/算法标题：", ...result.captions.slice(0, 60).map((item) => `- ${at(item)} ${item.caption}`));
	}
	if (result.outline.length > 0) {
		lines.push("章节（行号）：", ...result.outline.slice(0, 60).map((item) => `- ${at(item)} ${item.title}`));
	}
	if (result.disclosure_clues.length > 0) {
		lines.push(
			"公开状态线索（arXiv、DOI、会议/期刊、代码仓库等；用于新颖性判断）：",
			...result.disclosure_clues.map((item) => `- ${at(item)} [${item.kind}] ${item.text}`),
		);
	} else {
		lines.push("未发现 arXiv/DOI/会议等公开线索；公开状态仍需向用户确认或在 notes 中标为待确认。");
	}
	if (result.warnings.length > 0) lines.push("注意：", ...result.warnings.map((warning) => `- ${warning}`));
	return lines.join("\n");
}

export function registerIngestTool(pi: ExtensionAPI, core: CoreState): void {
	pi.registerTool({
		name: "paper_ingest",
		label: "Paper Ingest",
		description:
			"解析论文或材料文件（PDF、DOCX、TeX、Markdown、TXT）为可完整阅读的内容：带 [[page N]] 页码标记的全文 paper.md、方法图/表格所在页的 PNG、图表标题索引、章节行号，以及 arXiv/DOI/会议/代码仓库等公开状态线索。原件会被标记为只读。",
		promptSnippet: "解析论文为带页码的全文、页面图像、图表索引与公开状态线索",
		parameters: Type.Object({
			path: Type.String({ description: "论文文件路径（相对工作目录或绝对路径）" }),
			out_dir: Type.Optional(Type.String({ description: `输出目录，默认 ${STATE_DIR}/sources/<文件名>` })),
			pages: Type.Optional(
				Type.String({
					description:
						"要渲染成 PNG 的页：auto（默认：≤12 页全渲染，否则渲染首页和含图表标题的页）、all、none，或页码列表如 3-5,8",
				}),
			),
			dpi: Type.Optional(Type.Number({ description: "渲染分辨率，默认 110；看小字或复杂图时可用 150" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const source = resolve(ctx.cwd, cleanPathArg(params.path));
			if (!existsSync(source)) throw new Error(`文件不存在：${source}`);
			const stem = basename(source, extname(source));
			const outDir = params.out_dir
				? resolve(ctx.cwd, cleanPathArg(params.out_dir))
				: join(ctx.cwd, STATE_DIR, "sources", stem);
			const args = [source, "-o", outDir, "--pages", params.pages ?? "auto"];
			if (params.dpi) args.push("--dpi", String(Math.round(params.dpi)));
			const run = await runPython(join(AGENT_ROOT, "python", "ingest_paper.py"), args, { cwd: ctx.cwd, signal });
			const lastLine = run.stdout.trim().split(/\r?\n/).pop() ?? "";
			let result: IngestResult & { error?: string };
			try {
				result = JSON.parse(lastLine) as IngestResult & { error?: string };
			} catch {
				throw new Error(`论文解析失败（退出码 ${run.code}）：${(run.stderr || run.stdout).trim().slice(-2000)}`);
			}
			if (result.error) throw new Error(result.error);
			core.protect(source);
			if (!pi.getSessionName()) pi.setSessionName(`2pi：${stem}`);
			return { content: [{ type: "text", text: formatIngest(result) }], details: result };
		},
	});
}
