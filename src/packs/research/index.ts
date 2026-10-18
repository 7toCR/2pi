import { existsSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AGENT_ROOT } from "../../core/config.ts";
import { readSearches, searchLogPath } from "../../core/online.ts";
import { cleanPathArg, isInside, slash } from "../../core/paths.ts";
import { readProjectCard, readProjectFields, STATE_DIR } from "../../core/project.ts";
import { loadSkill } from "../../core/skill.ts";
import type { Pack } from "../types.ts";
import { addToLibrary, libraryPath, librarySummary, loadLibrary, unverifiedCitations, type Work, workKey } from "./library.ts";
import { describePatent } from "./patents.ts";
import { researchChecks } from "./doctor.ts";
import { describeWork } from "./literature.ts";
import { registerResearchTools, serviceStatus } from "./tools.ts";

/** Drafts whose citations the gate checks: prose, LaTeX, bibliographies, patent JSON. */
const CHECKED_EXT = new Set([".md", ".tex", ".bib", ".json", ".txt"]);

const GUIDE = `调研工具与文件（规则见上面的 research skill）：
- lit_search：OpenAlex（默认，题名与摘要）、arXiv（最新预印本）、Crossref（兜底）；citing / references_of 用于滚雪球。lit_fetch：按 DOI/arXiv/OpenAlex 编号核实一篇文献，给出完整摘要、仅由元数据生成的 BibTeX，download_pdf 下载开放获取 PDF（先试开放获取链接，再试出版社页面声明的 PDF）后用 paper_ingest 读全文；拿不到全文就依据摘要并注明，不要自己写脚本抓取出版社网页。
- patent_search：配置了 EPO OPS 时直接检索；否则只返回 Google Patents / Espacenet 链接，由用户检索并导出 CSV，再用 patent_import 导入。bib_lookup 核对 .bib 时，Crossref 或 DataCite（arXiv 的 10.48550 DOI 在这里）确认存在的 DOI 也会进入调研库。
- 检索、获取、导入的结果自动进入调研库（.2pi/research/library.json）；每次联网请求记入检索日志，用户用 /research 查看。
- 联网检索需要项目卡"联网检索：允许"或用户在本会话中确认。未获许可时不要用 bash、curl 或脚本绕过，改为写出检索式和链接，请用户检索后导出给你。
- 调研报告写在 research/<主题>.md；论文相关工作的文献从 lit_fetch 的记录加入 .bib；专利的检索式与对比文件候选写进专利 JSON 的 notes["检索与对比文件"]（字符串列表，进入撰写说明，不进申请文本）。
- 交付前检查会核对本轮写入文件中的 DOI、arXiv 编号和专利公开号：不在调研库、作者材料或已解析论文中的，要么用工具核实（自动入库），要么删除，要么在同一行（.bib 为同一条目）写明"待核实"并列入说明。`;

export function createResearchPack(skillDir = join(AGENT_ROOT, "skills", "research")): Pack {
	const skill = loadSkill(skillDir, {
		"search-strategy.md": "动手检索前：特征拆分、中英文同义词、分类号、各数据库语法、检索记录",
		"idea-survey.md": "写 idea / 相关工作调研报告时：报告模板与对比矩阵规则",
		"prior-art-search.md": "为专利草稿做现有技术检索时：检索式、对比文件候选表、写进撰写说明的格式",
	});
	/** Files written in the current user prompt, checked for unverified citations at the gate. */
	const written = new Set<string>();

	return {
		id: "research",
		title: "文献与 idea 调研、专利现有技术检索（检索式与对比文件候选）",
		skill,
		auxiliary: true,

		// A card that allows online search signals research intent, as do earlier results.
		detect(cwd) {
			return readProjectCard(cwd).onlineSearch || existsSync(join(cwd, "research")) || existsSync(libraryPath(cwd));
		},

		register(pi, core) {
			registerResearchTools(pi, core);

			pi.on("before_agent_start", () => {
				written.clear();
			});

			pi.on("tool_result", (event, ctx) => {
				if (event.isError) return undefined;
				if ((event.toolName === "write" || event.toolName === "edit") && typeof event.input.path === "string") {
					const path = resolve(ctx.cwd, cleanPathArg(event.input.path));
					const skip = [join(ctx.cwd, STATE_DIR), join(ctx.cwd, readProjectFields(ctx.cwd).materials ?? "materials")];
					if (CHECKED_EXT.has(extname(path).toLowerCase()) && isInside(path, ctx.cwd) && !skip.some((dir) => isInside(path, dir))) {
						written.add(path);
					}
				}
				// DOIs Crossref or DataCite confirmed (or Crossref offered as candidates) exist: they count as verified.
				if (event.toolName === "bib_lookup") {
					const results = (event.details as { results?: { key: string; status: string; doi?: string; registry?: string; candidates?: { doi: string; title: string; year?: number }[] }[] })
						?.results;
					const works: Work[] = [];
					for (const result of results ?? []) {
						if (result.doi && (result.status === "record-matches" || result.status === "fields-differ")) {
							works.push(crossrefWork(result.doi, `(.bib: ${result.key})`, undefined, result.registry === "DataCite" ? "datacite" : "crossref"));
						}
						for (const candidate of result.candidates ?? []) works.push(crossrefWork(candidate.doi, candidate.title, candidate.year));
					}
					if (works.length > 0) addToLibrary(ctx.cwd, { works });
				}
				return undefined;
			});

			pi.registerCommand("research", {
				description: "调研库与检索日志：/research 概况；/research works|patents|log 列出明细",
				getArgumentCompletions: (prefix) =>
					["works", "patents", "log"].filter((value) => value.startsWith(prefix.trim())).map((value) => ({ value, label: value })),
				handler: async (args, ctx) => notify(ctx, researchReport(ctx.cwd, args.trim())),
			});
		},

		agentAreas(cwd) {
			return [join(cwd, "research")];
		},

		guide() {
			return `${GUIDE}\n- 可用服务：${serviceStatus()}。`;
		},

		stateLines(cwd) {
			const library = loadLibrary(cwd);
			const searches = readSearches(cwd);
			if (library.works.length === 0 && library.patents.length === 0 && searches.length === 0) return [];
			const last = searches.at(-1);
			return [
				`调研库：${librarySummary(library)}；联网检索 ${searches.length} 次${last ? `，最近一次 ${last.time.slice(0, 10)}（${last.service}）` : ""}。`,
			];
		},

		async autoCheck(cwd) {
			const files = [...written].filter((path) => existsSync(path));
			if (files.length === 0) return undefined;
			const unverified = unverifiedCitations(cwd, files);
			if (unverified.length === 0) return undefined;
			const shown = unverified.slice(0, 20).map((c) => `- ${c.file}:${c.line} ${c.label}`);
			return {
				text: [
					"引用核验：以下编号不在调研库（检索、获取、导入或 bib_lookup 确认过的条目）、作者材料或已解析的论文中，可能是凭记忆写的：",
					...shown,
					...(unverified.length > shown.length ? [`… 共 ${unverified.length} 处`] : []),
					'处理：用 lit_fetch、bib_lookup、patent_search / patent_import 核实（会自动入库）；核实不了就删除，或在同一行（.bib 为同一条目）写明"待核实"并列入说明。不要凭记忆补全编号。',
				].join("\n"),
				needsFix: true,
			};
		},

		doctor(_cwd, options) {
			return researchChecks(options);
		},

		pendingWork() {
			return [];
		},
	};
}

function crossrefWork(doi: string, title: string, year?: number, source = "crossref"): Work {
	const work: Work = { key: "", title, authors: [], year, doi, source, seen: new Date().toISOString() };
	work.key = workKey(work);
	return work;
}

function notify(ctx: ExtensionContext, text: string): void {
	if (ctx.hasUI) ctx.ui.notify(text, "info");
	else console.log(text);
}

export function researchReport(cwd: string, view: string): string {
	const library = loadLibrary(cwd);
	const searches = readSearches(cwd);
	if (view === "works") return library.works.map((work, i) => describeWork(work, i + 1, 0)).join("\n") || "调研库中还没有文献。";
	if (view === "patents") return library.patents.map((patent, i) => describePatent(patent, i + 1, 0)).join("\n") || "调研库中还没有专利。";
	const log = searches
		.slice(view === "log" ? -100 : -10)
		.map((s) => `${s.time.slice(0, 16).replace("T", " ")} ${s.service} ${s.tool}：${s.query}${s.error ? `（失败：${s.error}）` : ` → ${s.results ?? "?"} 条`}`);
	if (view === "log") return log.join("\n") || "还没有联网检索。";
	return [
		`调研库（${slash(relative(cwd, libraryPath(cwd)))}）：${librarySummary(library)}。`,
		`检索日志（${slash(relative(cwd, searchLogPath(cwd)))}）：共 ${searches.length} 次${log.length ? "，最近：" : "。"}`,
		...log,
		`服务：${serviceStatus()}`,
		"/research works · /research patents · /research log 查看明细",
	].join("\n");
}
