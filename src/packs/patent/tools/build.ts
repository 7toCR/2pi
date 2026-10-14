import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { env } from "../../../core/config.ts";
import { exportWithWord, findSoffice, listPageImages, renderPdfPages } from "../../../core/office.ts";
import { cleanPathArg, slash } from "../../../core/paths.ts";
import { clip, runPython } from "../../../core/python.ts";
import type { SkillKnowledge } from "../../../core/skill.ts";
import type { PatentState } from "../state.ts";
import { checkAdvice, runCheck } from "./check.ts";

const STAGES = ["drawings", "docx", "pdf"] as const;
type Stage = (typeof STAGES)[number];

/** File-system-safe document name derived from the invention name. */
export function documentName(jsonPath: string, explicit: string | undefined): string {
	let name = explicit?.trim();
	if (!name) {
		try {
			const data = JSON.parse(readFileSync(jsonPath, "utf8")) as { invention_name?: unknown };
			if (typeof data.invention_name === "string") name = data.invention_name;
		} catch {
			// Fall back to the file name below.
		}
	}
	name = (name || basename(jsonPath, ".json"))
		.replace(/[\\/:*?"<>|\r\n\t]/g, "")
		.replace(/\s+/g, "")
		.slice(0, 40);
	return name || "专利申请";
}

function drawingPngs(jsonPath: string): string[] {
	const data = JSON.parse(readFileSync(jsonPath, "utf8")) as { drawing_assets?: Array<{ png_path?: string }> };
	return (data.drawing_assets ?? [])
		.map((asset) => asset.png_path)
		.filter((path): path is string => typeof path === "string" && path.length > 0)
		.map((path) => resolve(dirname(jsonPath), path));
}

function failure(stage: string, run: { code: number | null; stdout: string; stderr: string }): Error {
	return new Error(`${stage}失败（退出码 ${run.code}）：\n${clip(`${run.stdout}\n${run.stderr}`.trim(), 6000)}`);
}

export function registerBuildTool(pi: ExtensionAPI, skill: SkillKnowledge, state: PatentState): void {
	pi.registerTool({
		name: "patent_build",
		label: "Patent Build",
		description:
			"由 patent.json 生成交付文件：附图 SVG/PNG（并把 drawing_assets 写回 JSON）→ 申请文件 DOCX + 撰写说明 DOCX → PDF 与逐页预览 PNG。PDF 优先用 LibreOffice，没有时在 Windows 上用 Microsoft Word 导出，都没有时生成图像版审阅 PDF。构建前自动运行检查，有 ERROR 时拒绝构建（force=true 可生成仅供审阅的版本）。",
		promptSnippet: "由 patent.json 生成附图、申请文件 DOCX、撰写说明 DOCX、PDF 与预览页",
		promptGuidelines: ["patent_build 之后，用 read 逐张查看返回的附图与预览页，有问题就改 patent.json 重新构建"],
		parameters: Type.Object({
			json_path: Type.String({ description: "专利 JSON 路径" }),
			out_dir: Type.Optional(Type.String({ description: "输出目录，默认 JSON 所在目录下的 out/" })),
			name: Type.Optional(Type.String({ description: "文件名前缀，默认取 invention_name" })),
			stages: Type.Optional(
				Type.Array(StringEnum(STAGES), { description: "要执行的阶段，默认全部：drawings、docx、pdf" }),
			),
			force: Type.Optional(Type.Boolean({ description: "检查有 ERROR 时仍然构建（仅用于审阅中间稿）" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const jsonPath = resolve(ctx.cwd, cleanPathArg(params.json_path));
			if (!existsSync(jsonPath)) throw new Error(`文件不存在：${jsonPath}`);
			const outDir = params.out_dir ? resolve(ctx.cwd, cleanPathArg(params.out_dir)) : join(dirname(jsonPath), "out");
			const stages = new Set<Stage>(params.stages && params.stages.length > 0 ? params.stages : STAGES);
			const name = documentName(jsonPath, params.name);
			const docxPath = join(outDir, `${name}_专利申请文件.docx`);
			const notesPath = join(outDir, `${name}_专利申请文件_撰写说明.docx`);
			const pdfPath = join(outDir, `${name}_专利申请文件.pdf`);
			const previewDir = join(outDir, "preview");
			const progress = (text: string) => onUpdate?.({ content: [{ type: "text", text }], details: undefined });
			const lines: string[] = [];
			const opts = { cwd: dirname(jsonPath), signal };

			const check = await runCheck(skill, state, jsonPath, signal);
			if (check.errors > 0 && !params.force) {
				return {
					content: [{ type: "text", text: `未构建：${checkAdvice(check)}\n\n${clip(check.report)}` }],
					details: { built: false, errors: check.errors },
					isError: true,
				};
			}
			if (check.errors > 0) lines.push(`注意：检查仍有 ${check.errors} 个 ERROR，本次输出仅供审阅，不可交付。`);
			mkdirSync(outDir, { recursive: true });

			let drawings: string[] = [];
			if (stages.has("drawings")) {
				progress("生成附图…");
				const run = await runPython(
					join(skill.scriptsDir, "generate_patent_drawings.py"),
					[jsonPath, "-o", outDir, "--update-json"],
					opts,
				);
				if (run.code !== 0) throw failure("附图生成", run);
				drawings = drawingPngs(jsonPath);
				lines.push(`附图 ${drawings.length} 张：`, ...drawings.map((path) => `- ${slash(path)}`));
			}

			if (stages.has("docx")) {
				progress("生成 DOCX…");
				const run = await runPython(
					join(skill.scriptsDir, "generate_patent_docx.py"),
					[jsonPath, "-o", docxPath, "--require-drawings"],
					opts,
				);
				if (run.code !== 0) throw failure("DOCX 生成", run);
				lines.push(`申请文件：${slash(docxPath)}`);
				if (existsSync(notesPath)) lines.push(`撰写说明：${slash(notesPath)}`);
			}

			let previews: string[] = [];
			if (stages.has("pdf")) {
				if (!existsSync(docxPath)) throw new Error(`PDF 阶段需要先生成 DOCX：${docxPath}`);
				const useWord = !findSoffice() && process.platform === "win32" && !env("NO_WORD");
				/**
				 * One DOCX → PDF + page previews: LibreOffice through the skill script, Microsoft Word when
				 * LibreOffice is missing, and the skill's image-based review PDF when neither exists.
				 */
				const exportPdf = async (docx: string, pdf: string, pagesDir: string, contentJson?: string) => {
					rmSync(pagesDir, { recursive: true, force: true });
					if (useWord) {
						const word = await exportWithWord(docx, pdf, signal);
						if (word.ok) {
							return { pages: renderPdfPages(pdf, pagesDir), note: `Microsoft Word 导出，文字可检索${word.pages ? `，${word.pages} 页` : ""}` };
						}
						lines.push(`Word 导出 ${basename(pdf)} 失败（${word.error ?? "未知原因"}）。`);
					}
					const args = [docx, "-o", pdf, "--preview-dir", pagesDir, ...(contentJson ? ["--content-json", contentJson] : [])];
					const run = await runPython(join(skill.scriptsDir, "export_patent_pdf.py"), args, opts);
					// Exit 3: no LibreOffice and no content JSON for the image fallback (drafting notes).
					if (run.code === 3 && !contentJson) return undefined;
					if (run.code !== 0) throw failure("PDF 导出", run);
					const output = `${run.stdout}\n${run.stderr}`.trim();
					const pages = listPageImages(pagesDir);
					return {
						pages: pages.length > 0 ? pages : renderPdfPages(pdf, pagesDir),
						note: /image-based/i.test(output)
							? "图像版审阅 PDF，文字不可检索；安装 LibreOffice 或 Microsoft Word 后重新构建可得到正式 PDF"
							: "LibreOffice 导出",
					};
				};

				progress("导出申请文件 PDF 与预览页…");
				const application = await exportPdf(docxPath, pdfPath, previewDir, jsonPath);
				previews = application?.pages ?? [];
				lines.push(`PDF：${slash(pdfPath)}（${application?.note ?? ""}）`);
				if (previews.length > 0) lines.push(`预览页 ${previews.length} 张：`, ...previews.map((path) => `- ${slash(path)}`));

				if (existsSync(notesPath)) {
					progress("导出撰写说明 PDF…");
					const notesPdf = notesPath.replace(/\.docx$/i, ".pdf");
					const notes = await exportPdf(notesPath, notesPdf, join(outDir, "notes_preview"));
					if (notes) {
						previews = [...previews, ...notes.pages];
						lines.push(
							`撰写说明 PDF：${slash(notesPdf)}（${notes.note}）`,
							...(notes.pages.length > 0 ? [`撰写说明预览页 ${notes.pages.length} 张：`, ...notes.pages.map((path) => `- ${slash(path)}`)] : []),
						);
					}
				}
			}

			state.recordBuild(drawings, previews, stages.has("pdf") ? [pdfPath] : []);
			if (check.warnings > 0) lines.push(`检查：0 个 ERROR，${check.warnings} 个 WARN（${checkAdvice(check)}）`);
			if (drawings.length > 0 || previews.length > 0) {
				lines.push("下一步：用 read 逐张查看上面的附图 PNG 与预览页，确认版面清晰、内容与论文一致，有问题就改 JSON 重新构建。");
			}
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { built: true, outDir, docxPath, notesPath, pdfPath, drawings, previews },
			};
		},
	});
}
