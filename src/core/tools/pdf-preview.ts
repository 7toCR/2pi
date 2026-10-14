import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { slash as toPosix } from "../paths.ts";
import { detectRenderer, parsePages, pdfPageCount, RENDERER_HELP, renderPages } from "../pdf.ts";
import { readProjectFields } from "../project.ts";

const MAX_PAGES = 6;

/** The compiled manuscript: build/<main>.pdf next to the project card's manuscript (default paper/main.tex). */
export function defaultPdf(cwd: string): string | undefined {
	const manuscript = resolve(cwd, readProjectFields(cwd).manuscript ?? join("paper", "main.tex"));
	if (!manuscript.endsWith(".tex") || !existsSync(manuscript)) return undefined;
	return join(dirname(manuscript), "build", basename(manuscript).replace(/\.tex$/i, ".pdf"));
}

export const pdfPreviewTool = defineTool({
	name: "pdf_preview",
	label: "Preview PDF pages",
	description: `Render PDF pages as images so you can see figures, tables, captions and page layout (overfull lines, floats far from their first mention, unreadable axis labels, empty pages). Default: the compiled manuscript (build/main.pdf) pages 1-3. At most ${MAX_PAGES} pages per call. Needs pdftoppm, mutool or Ghostscript, and a model that accepts images.`,
	promptSnippet: "Render pages of the compiled PDF (or any PDF) as images for visual checks",
	promptGuidelines: [
		"Judge visual quality (figures, tables, layout) only for pages you rendered with pdf_preview and actually saw; for anything else say in 待核验事项 that it was not inspected.",
	],
	parameters: Type.Object({
		pdf: Type.Optional(Type.String({ description: "PDF file; default: the compiled manuscript" })),
		pages: Type.Optional(Type.String({ description: 'Pages, e.g. "1-3" or "2,5"; default "1-3"' })),
		width: Type.Optional(Type.Integer({ minimum: 400, maximum: 2400, description: "Image width in pixels; default 1400" })),
	}),

	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		const pdf = params.pdf ? resolve(ctx.cwd, params.pdf) : defaultPdf(ctx.cwd);
		if (!pdf) throw new Error("No PDF given and no LaTeX manuscript (paper/main.tex or 稿件 in 2PI.md).");
		if (!existsSync(pdf)) throw new Error(`${toPosix(relative(ctx.cwd, pdf))} does not exist; compile first (latex_compile).`);
		const renderer = detectRenderer();
		if (!renderer) throw new Error(RENDERER_HELP);
		const total = await pdfPageCount(pdf, signal);
		const requested = parsePages(params.pages ?? "1-3", total ?? Number.POSITIVE_INFINITY);
		const pages = requested.slice(0, MAX_PAGES);
		const rendered = await renderPages(renderer, pdf, pages, params.width ?? 1400, signal);
		const shown = rendered.map((r) => r.page);
		const rel = toPosix(relative(ctx.cwd, pdf)) || pdf;
		const note =
			requested.length > pages.length ? ` Only the first ${MAX_PAGES} requested pages are shown; ask for the rest separately.` : "";
		const content: (TextContent | ImageContent)[] = [
			{
				type: "text",
				text: `${rel}: ${total ?? "unknown number of"} page(s); showing page(s) ${shown.join(", ")} (rendered with ${renderer.kind}).${note}`,
			},
		];
		for (const page of rendered) {
			content.push({ type: "text", text: `Page ${page.page}:` });
			content.push({ type: "image", data: page.png.toString("base64"), mimeType: "image/png" });
		}
		return { content, details: { pdf, pages: shown, total, renderer: renderer.kind } };
	},
});
