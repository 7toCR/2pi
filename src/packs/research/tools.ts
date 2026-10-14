import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { env } from "../../core/config.ts";
import { ensureOnline, logSearch, request } from "../../core/online.ts";
import { cleanPathArg, isInside, slash } from "../../core/paths.ts";
import { STATE_DIR } from "../../core/project.ts";
import type { CoreState } from "../../core/state.ts";
import { addToLibrary, normalizeDoi, type Work } from "./library.ts";
import {
	describeWork,
	getArxiv,
	getCrossref,
	getOpenAlex,
	type LitQuery,
	type LitResult,
	type LitSource,
	searchArxiv,
	searchCrossref,
	searchOpenAlex,
	toBibtex,
} from "./literature.ts";
import { describePatent, importPatentCsv, opsConfigured, opsQuery, patentSearchLinks, searchOps } from "./patents.ts";

const MAX_PDF_BYTES = 40 * 1024 * 1024;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type WorkId = { kind: "doi" | "arxiv" | "openalex"; value: string };

/** DOI, arXiv id or OpenAlex id, bare or as a URL. */
export function parseWorkId(raw: string): WorkId | undefined {
	const value = raw.trim();
	const arxiv = /(?:arxiv[:\s]*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})(?:v\d+)?/i.exec(value) ?? /^(\d{4}\.\d{4,5})(?:v\d+)?$/.exec(value);
	if (arxiv?.[1]) return { kind: "arxiv", value: arxiv[1] };
	const doi = /10\.\d{4,9}\/\S+/.exec(value);
	if (doi) return { kind: "doi", value: normalizeDoi(doi[0]) };
	const openalex = /(?:openalex\.org\/)?(W\d+)$/i.exec(value);
	if (openalex?.[1]) return { kind: "openalex", value: openalex[1].toUpperCase() };
	return undefined;
}

/** Publisher pages name their PDF in a Highwire meta tag; most open-access journals set it. */
export function citationPdfUrl(html: string, base: string): string | undefined {
	for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
		if (!/name\s*=\s*["']citation_pdf_url["']/i.test(tag)) continue;
		const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
		if (!content) continue;
		try {
			return new URL(content.replace(/&amp;/g, "&"), base).toString();
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/**
 * The open-access PDF of a work: the provider's PDF link, else the PDF the landing page declares
 * (citation_pdf_url). Saved under .2pi/sources/lit/ for paper_ingest; every request is logged.
 */
async function downloadPdf(work: Work, cwd: string, signal?: AbortSignal): Promise<{ path?: string; reason: string }> {
	const tried: string[] = [];
	const fetchPdf = async (url: string): Promise<Buffer | undefined> => {
		tried.push(url);
		const res = await request(url, { signal, timeoutMs: 60_000, headers: { Accept: "application/pdf" } });
		logSearch(cwd, { tool: "lit_fetch", service: new URL(url).host, query: `download ${url}`, results: res.ok ? 1 : 0 });
		const bytes = res.ok && res.arrayBuffer ? Buffer.from(await res.arrayBuffer()) : undefined;
		return bytes && bytes.subarray(0, 5).toString("latin1") === "%PDF-" && bytes.length <= MAX_PDF_BYTES ? bytes : undefined;
	};
	try {
		let bytes = work.pdfUrl ? await fetchPdf(work.pdfUrl) : undefined;
		const landing = work.url ?? (work.doi ? `https://doi.org/${work.doi}` : undefined);
		if (!bytes && landing) {
			const res = await request(landing, { signal, timeoutMs: 30_000, headers: { Accept: "text/html" } });
			logSearch(cwd, { tool: "lit_fetch", service: new URL(landing).host, query: `landing page ${landing}`, results: res.ok ? 1 : 0 });
			const declared = res.ok && res.text ? citationPdfUrl(await res.text(), landing) : undefined;
			if (declared && !tried.includes(declared)) bytes = await fetchPdf(declared);
		}
		if (!bytes) return { reason: tried.length ? "开放获取链接没有返回 PDF（可能需要订阅或登录）" : "没有已知的开放获取 PDF" };
		const dir = join(cwd, STATE_DIR, "sources", "lit");
		mkdirSync(dir, { recursive: true });
		const path = join(dir, `${work.key.replace(/[^\w.-]+/g, "_")}.pdf`);
		writeFileSync(path, bytes);
		return { path, reason: "" };
	} catch (error) {
		return { reason: message(error) };
	}
}

const SOURCE_NAME: Record<LitSource, string> = { openalex: "OpenAlex", arxiv: "arXiv", crossref: "Crossref" };

export function registerResearchTools(pi: ExtensionAPI, core: CoreState): void {
	pi.registerTool({
		name: "lit_search",
		label: "Literature search",
		description:
			"检索学术文献（只发送检索词）。source：openalex（默认，题名与摘要检索，含摘要、被引次数、开放获取链接）、arxiv（最新预印本）、crossref（OpenAlex 不可用时的兜底）。citing / references_of（OpenAlex 编号或 DOI）用于滚雪球：查引用某篇的文献、某篇引用的文献。结果自动进入调研库，检索记录写入检索日志。",
		promptSnippet: "检索学术文献（OpenAlex/arXiv/Crossref），结果进入调研库",
		promptGuidelines: [
			"调研时先写出检索策略再检索；引用的每篇文献都必须来自 lit_search / lit_fetch / bib_lookup 的结果或作者材料，不凭记忆补 DOI、arXiv 编号或作者年份",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "检索词（英文效果最好）；双引号表示短语" })),
			source: Type.Optional(StringEnum(["openalex", "arxiv", "crossref"] as const, { description: "默认 openalex" })),
			year_from: Type.Optional(Type.Integer({ minimum: 1900, maximum: 2100 })),
			year_to: Type.Optional(Type.Integer({ minimum: 1900, maximum: 2100 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25, description: "默认 10" })),
			citing: Type.Optional(Type.String({ description: "只看引用了这篇文献的工作（OpenAlex 编号或 DOI）" })),
			references_of: Type.Optional(Type.String({ description: "只看这篇文献引用的工作（OpenAlex 编号或 DOI）" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!params.query && !params.citing && !params.references_of) throw new Error("需要 query，或 citing / references_of。");
			await ensureOnline(ctx, core);
			let source: LitSource = params.source ?? "openalex";
			if ((params.citing || params.references_of) && source !== "openalex") throw new Error("citing / references_of 只支持 OpenAlex。");
			const toOpenAlexId = async (raw: string | undefined) => {
				if (!raw) return undefined;
				const id = parseWorkId(raw);
				if (id?.kind === "openalex") return id.value;
				if (!id) throw new Error(`无法识别的文献编号：${raw}`);
				const work = await getOpenAlex(id.kind === "arxiv" ? `arxiv:${id.value}` : id.value, signal);
				if (!work?.openalex) throw new Error(`OpenAlex 中没有 ${raw}`);
				return work.openalex;
			};
			const query: LitQuery = {
				query: params.query?.trim() || undefined,
				yearFrom: params.year_from,
				yearTo: params.year_to,
				limit: params.limit ?? 10,
				citing: await toOpenAlexId(params.citing),
				referencedBy: await toOpenAlexId(params.references_of),
			};
			const run = (s: LitSource): Promise<LitResult> =>
				s === "arxiv" ? searchArxiv(query, signal) : s === "crossref" ? searchCrossref(query, signal) : searchOpenAlex(query, signal);
			let result: LitResult;
			let note = "";
			try {
				result = await run(source);
			} catch (error) {
				logSearch(ctx.cwd, { tool: "lit_search", service: SOURCE_NAME[source], query: query.query ?? "", error: message(error) });
				// OpenAlex meters its free tier per day; Crossref still answers plain searches.
				if (source !== "openalex" || !query.query || query.citing || query.referencedBy) throw error;
				note = `OpenAlex 不可用（${message(error)}），改用 Crossref（无摘要与开放获取链接；可设置 TWOPI_OPENALEX_KEY 提高额度）。\n`;
				source = "crossref";
				result = await run(source);
			}
			logSearch(ctx.cwd, { tool: "lit_search", service: SOURCE_NAME[source], query: result.sent, results: result.works.length });
			addToLibrary(ctx.cwd, { works: result.works });
			const lines = [
				`${note}${SOURCE_NAME[source]}：${result.sent}`,
				`共 ${result.total ?? "?"} 条，显示 ${result.works.length} 条（已加入调研库）。`,
				...result.works.map((work, i) => describeWork(work, i + 1)),
			];
			if (result.works.length === 0) lines.push("没有结果：换用同义词、放宽限定，或换一个来源。");
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { source, sent: result.sent, total: result.total, keys: result.works.map((w) => w.key) },
			};
		},
	});

	pi.registerTool({
		name: "lit_fetch",
		label: "Fetch a work",
		description:
			"按 DOI、arXiv 编号或 OpenAlex 编号取一篇文献的完整信息：作者、出处、年份、完整摘要、开放获取链接，以及只用元数据生成的 BibTeX。download_pdf 会把开放获取 PDF 存到 .2pi/sources/lit/，再用 paper_ingest 解析全文。找不到就说明这个编号不存在或未被收录，不要引用它。",
		promptSnippet: "按 DOI/arXiv/OpenAlex 编号核实并获取一篇文献（含 BibTeX，可下载开放获取 PDF）",
		executionMode: "sequential",
		parameters: Type.Object({
			id: Type.String({ description: "DOI、arXiv 编号或 OpenAlex 编号（也可以是链接）" }),
			download_pdf: Type.Optional(Type.Boolean({ description: "下载开放获取 PDF 以便阅读全文；默认 false" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const id = parseWorkId(params.id);
			if (!id) throw new Error(`无法识别的文献编号：${params.id}（支持 DOI、arXiv 编号、OpenAlex W 编号）`);
			await ensureOnline(ctx, core);
			let work: Work | undefined;
			let service = "OpenAlex";
			try {
				if (id.kind === "arxiv") {
					service = "arXiv";
					work = await getArxiv(id.value, signal);
				} else {
					work = await getOpenAlex(id.value, signal);
					if (!work && id.kind === "doi") {
						service = "Crossref";
						work = await getCrossref(id.value, signal);
					}
				}
			} catch (error) {
				if (id.kind !== "doi") throw error;
				service = "Crossref";
				work = await getCrossref(id.value, signal);
			}
			logSearch(ctx.cwd, { tool: "lit_fetch", service, query: `${id.kind}:${id.value}`, results: work ? 1 : 0 });
			if (!work) {
				return {
					content: [{ type: "text", text: `${id.kind}:${id.value} 在 ${service} 中不存在或未被收录。不要引用它；如果来源可靠，交给作者核实。` }],
					details: { found: false },
					isError: true,
				};
			}
			addToLibrary(ctx.cwd, { works: [work] });
			const lines = [
				describeWork(work, undefined, 6000),
				work.url ? `链接：${work.url}` : "",
				work.pdfUrl ? `开放获取 PDF：${work.pdfUrl}` : "没有已知的开放获取 PDF。",
				"",
				"BibTeX（只来自元数据；加入 .bib 前核对作者与出处）：",
				toBibtex(work),
			];
			let pdf: string | undefined;
			if (params.download_pdf) {
				const download = await downloadPdf(work, ctx.cwd, signal);
				pdf = download.path;
				lines.push(
					"",
					pdf
						? `PDF 已保存：${slash(relative(ctx.cwd, pdf))}（用 paper_ingest 解析后阅读全文）。`
						: `没有拿到全文 PDF：${download.reason}。只能依据摘要判断，在报告中注明；不要自己写脚本抓取出版社网页。`,
				);
			}
			return { content: [{ type: "text", text: lines.filter((l) => l !== "").join("\n") }], details: { found: true, key: work.key, pdf } };
		},
	});

	pi.registerTool({
		name: "patent_search",
		label: "Patent search",
		description:
			"检索专利（检索式或关键词，英文效果最好）。配置了 EPO OPS（TWOPI_EPO_OPS_KEY / TWOPI_EPO_OPS_SECRET）时直接检索全球专利（含中国），结果进入调研库；未配置时不联网，只返回 Google Patents、Espacenet 的检索链接：把检索式和链接交给用户，请用户导出 CSV 放进 materials/ 后用 patent_import 导入。",
		promptSnippet: "检索专利（EPO OPS；未配置时给出检索链接，由用户导出后导入）",
		promptGuidelines: [
			"专利公开号只能来自 patent_search / patent_import 的结果或作者材料；未检索到就写检索式和待检索事项，不要凭记忆列对比文件",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			query: Type.String({ description: "关键词，或 EPO CQL（如 ta all \"wavelet denoising\" and ic=G06F）" }),
			year_from: Type.Optional(Type.Integer({ minimum: 1900, maximum: 2100 })),
			year_to: Type.Optional(Type.Integer({ minimum: 1900, maximum: 2100, description: "通常取申请日（或优先权日）所在年份" })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "默认 20" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const links = patentSearchLinks(params.query, params.year_to);
			const linkLines = links.map((link) => `- ${link.name}：${link.url}`);
			if (!opsConfigured()) {
				return {
					content: [
						{
							type: "text",
							text: [
								"没有配置专利检索服务（EPO OPS），本次没有联网。可以交给用户的检索链接：",
								...linkLines,
								"把检索式和这些链接写进撰写说明或调研报告；请用户检索后导出 CSV（Google Patents：Download CSV；Espacenet：导出列表）放进 materials/，再用 patent_import 导入。导入前不要列出任何专利公开号。",
							].join("\n"),
						},
					],
					details: { configured: false, links },
				};
			}
			await ensureOnline(ctx, core);
			const cql = opsQuery(params.query, params.year_from, params.year_to);
			try {
				const { patents, total } = await searchOps(cql, params.limit ?? 20, signal);
				logSearch(ctx.cwd, { tool: "patent_search", service: "EPO OPS", query: cql, results: patents.length });
				addToLibrary(ctx.cwd, { patents });
				const lines = [
					`EPO OPS：${cql}`,
					`共 ${total ?? "?"} 件，显示 ${patents.length} 件（已加入调研库）。`,
					...patents.map((patent, i) => describePatent(patent, i + 1)),
					"",
					"同一检索在网页中查看：",
					...linkLines,
				];
				return { content: [{ type: "text", text: lines.join("\n") }], details: { configured: true, cql, total, keys: patents.map((p) => p.key) } };
			} catch (error) {
				logSearch(ctx.cwd, { tool: "patent_search", service: "EPO OPS", query: cql, error: message(error) });
				throw error;
			}
		},
	});

	pi.registerTool({
		name: "patent_import",
		label: "Import patent list",
		description:
			"导入用户从专利数据库导出的 CSV（Google Patents、Espacenet，或另存为 CSV 的国知局检索结果），按列名识别公开号、标题、申请人、公开日、摘要；导入的专利进入调研库，之后才能作为对比文件候选引用。不联网。",
		promptSnippet: "导入用户导出的专利检索结果 CSV，进入调研库",
		parameters: Type.Object({
			path: Type.String({ description: "CSV 文件（通常在 materials/ 中）" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const path = resolve(ctx.cwd, cleanPathArg(params.path));
			if (!existsSync(path)) throw new Error(`${params.path} 不存在。`);
			const source = `import:${isInside(path, ctx.cwd) ? slash(relative(ctx.cwd, path)) : slash(path)}`;
			const { patents, skipped, columns } = importPatentCsv(readFileSync(path, "utf8"), source);
			addToLibrary(ctx.cwd, { patents });
			const lines = [
				`导入 ${patents.length} 件专利${skipped ? `（跳过 ${skipped} 行没有公开号的记录）` : ""}；识别到的列：${columns.join("、")}。`,
				...patents.slice(0, 40).map((patent, i) => describePatent(patent, i + 1, 160)),
				...(patents.length > 40 ? [`… 其余 ${patents.length - 40} 件已入库，可用 /research 查看。`] : []),
			];
			return { content: [{ type: "text", text: lines.join("\n") }], details: { imported: patents.length, skipped } };
		},
	});
}

/** Which optional services are configured, for /research and the prompt. */
export function serviceStatus(): string {
	return [
		`OpenAlex${env("OPENALEX_KEY") ? "（已配置 API key）" : "（免费额度，约每天 100 次检索）"}`,
		"arXiv",
		"Crossref",
		opsConfigured() ? "EPO OPS（已配置）" : "EPO OPS 未配置（专利检索改为给出链接 + 导入 CSV）",
	].join("、");
}

