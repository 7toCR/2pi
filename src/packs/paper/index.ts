import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { AGENT_ROOT, ENV_PREFIX, resolveSkillDir } from "../../core/config.ts";
import type { DoctorCheck } from "../../core/doctor.ts";
import { cleanPathArg, isInside, slash } from "../../core/paths.ts";
import { detectRenderer } from "../../core/pdf.ts";
import { LEGACY_PAPER_FILE, PROJECT_FILE, STATE_DIR } from "../../core/project.ts";
import { loadSkill, referenceIndex } from "../../core/skill.ts";
import type { Pack } from "../types.ts";
import { latexBlocks } from "./blocks.ts";
import { checkFile } from "./checker.ts";
import { initPaperWorkspace, isPaperWorkspace, LATEX_TEMPLATES, type LatexTemplate, latexProjectOf, loadPaperConfig } from "./config.ts";
import { paperAutoCheck } from "./gate.ts";
import { compileProject, detectEngine } from "./latex.ts";
import { paperRedline } from "./redline.ts";
import { isManuscriptFile, LATEX_SOURCE_EXT, PaperState } from "./state.ts";
import {
	createBibLookupTool,
	createCheckDraftTool,
	createFillGapsTool,
	createLatexCompileTool,
	formatPaperInit,
	paperInitTool,
} from "./tools.ts";

/** When to read each reference (from the skill's own task table). */
const REFERENCE_GUIDE: Record<string, string> = {
	"intake-and-workflow.md": "接手任务时先读：输入模板、四类证据、Flash/Pro 步骤、证据账本格式",
	"paper-layer.md": "每次起草或修改前必读：什么写进论文、什么写进中文说明，边界篇幅，缺口标记纪律",
	"introduction.md": "写引言、相关工作（按机制对比）、研究空白",
	"methodology.md": "写方法：细节分级（核心/惯例/设置）、符号、公式",
	"results-discussion.md": "写结果、分析、讨论与局限",
	"conclusion-abstract-title.md": "写结论、摘要、题目",
	"figures-tables.md": "规划图表、写图注、检查图",
	"reviewer-response.md": "逐条回复审稿意见",
	"quality-checklist.md": "投稿前检查与整稿终审",
	"source-map.md": "规则出处与可调整的经验值",
};

const GUIDE = `本领域交付：英文 SCI 论文初稿（LaTeX → PDF）与单独的中文说明。

文件：
- 作者材料在 materials/（只读）；稿件 paper/main.tex，各节在 paper/sections/*.tex，参考文献 paper/refs.bib，图在 paper/figures/，编译产物在 paper/build/。项目卡 2PI.md 写了其他路径时以它为准。新论文没有 paper/main.tex 时先用 paper_init 建立骨架。
- 中文说明写在 notes/memo.md，分"主要修改 / 材料缺口 / 待核验事项"，永远不进 PDF。稿件中每个 [MISSING: …] 都要在说明的"材料缺口"下引用一次。
- 作者的原始文件不要覆盖：修订写到新文件，除非作者明确同意原地修改。

证据账本（notes/evidence.json，论文与专利共用）：
- 写进稿件的每个事实和数字，先用 evidence 记账（类别与出处，一次可记多条）；冲突或缺失的值记为 missing，并在稿件中写 [MISSING: …]。
- 比率、差值、百分点、相对变化一律用 compute_stats 计算（可直接读 CSV 单元格），不要心算；两个百分比之差是百分点，相对变化另算。
- 检查器会把正文中的关键数字与账本逐一比对（V01）。修正文或修账本，绝不为了消除警告而记一个没有真实出处的数字。

检查与交付：
- 每一轮结束时，agent 会自动编译本轮改过的 LaTeX 并运行检查器；有错误时你会收到报告并进入修复轮，以那份报告为准。
- 字数上限只从 2PI.md 读取（摘要字数上限、标题字数上限）；用户或期刊须知给了上限就写进 2PI.md，绝不自己设定。
- 交付完整初稿前：用 bib_lookup 核对参考文献（记录存在且字段正确，不等于它支持那句话）；用 pdf_preview 看过编译后的页面，才能评价图、表和版面。
- 稿件默认用英文，除非用户要求；中文说明默认中文。交付消息给出文件路径、检查结果和说明要点，不粘贴整篇稿件。`;

export function createPaperPack(skillDir?: string): Pack {
	const skill = loadSkill(
		skillDir ??
			resolveSkillDir("research2paper", "PAPER_SKILL_DIR", [
				join(AGENT_ROOT, "skills", "research2paper"),
				join(AGENT_ROOT, "..", "reference", "research2paper", "skills", "research2paper"),
			]),
		REFERENCE_GUIDE,
	);
	const state = new PaperState();
	const checkerScript = join(skill.scriptsDir, "check_paper_draft.py");

	/** The paper drafts the agent owns: the LaTeX project, the notes, the ledger. */
	const areas = (cwd: string): string[] => {
		const config = loadPaperConfig(cwd);
		const result: string[] = [];
		if (config.manuscript?.endsWith(".tex")) result.push(dirname(config.manuscript));
		if (config.notes) result.push(config.notes);
		if (config.evidence) result.push(config.evidence);
		return result;
	};

	return {
		id: "paper",
		title: "研究材料 → 可逐句核对的 SCI 论文初稿（LaTeX/PDF + 中文说明）",
		skill,
		blocks: latexBlocks,
		redline: paperRedline,

		detect: isPaperWorkspace,

		init(cwd) {
			return initPaperWorkspace(cwd).created;
		},

		register(pi, core) {
			pi.registerTool(createCheckDraftTool(skill, state));
			pi.registerTool(createLatexCompileTool(state));
			pi.registerTool(paperInitTool);
			pi.registerTool(createFillGapsTool(skill, state, areas));
			pi.registerTool(createBibLookupTool());

			// Track drafts changed in this turn for the end-of-turn compile and check.
			pi.on("tool_result", (event, ctx) => {
				if (event.isError || (event.toolName !== "write" && event.toolName !== "edit")) return undefined;
				if (!core.activePacks(ctx.cwd).includes("paper")) return undefined;
				const raw = typeof event.input.path === "string" ? event.input.path : "";
				const path = resolve(ctx.cwd, cleanPathArg(raw));
				const config = loadPaperConfig(ctx.cwd);
				const project = config.manuscript?.endsWith(".tex") ? dirname(config.manuscript) : undefined;
				if (project && isInside(path, join(project, "build"))) return undefined;
				// Research reports (research/) are checked by the research pack, not as manuscript sections.
				const notOurs = [
					join(ctx.cwd, STATE_DIR),
					join(ctx.cwd, "patent"),
					join(ctx.cwd, "research"),
					join(ctx.cwd, PROJECT_FILE),
					join(ctx.cwd, LEGACY_PAPER_FILE),
				];
				if (notOurs.some((area) => isInside(path, area))) return undefined;
				const inProject = !!latexProjectOf(config, path);
				const isNotes = !!config.notes && resolve(config.notes) === path;
				// Elsewhere in notes/ live working files (fact sheet, ledger), not drafts.
				if (isNotes || inProject || (isManuscriptFile(path) && !isInside(path, join(ctx.cwd, "notes")))) {
					state.markUnchecked(path);
				}
				if (project && inProject && LATEX_SOURCE_EXT.test(path)) state.markUncompiled(project);
				return undefined;
			});

			pi.registerCommand("paper", {
				description: "论文：/paper status | init [article|elsarticle|ieeetran] | check | compile | final",
				getArgumentCompletions: (prefix) =>
					["status", "init", "check", "compile", "final"]
						.filter((value) => value.startsWith(prefix.trim()))
						.map((value) => ({ value, label: value })),
				handler: async (args, ctx) => {
					const [action = "status", arg] = args.trim().split(/\s+/).filter(Boolean);
					const config = loadPaperConfig(ctx.cwd);
					const rel = (p: string) => slash(relative(ctx.cwd, p)) || p;
					try {
						if (action === "init") {
							const template = (arg ?? "article").toLowerCase() as LatexTemplate;
							if (!LATEX_TEMPLATES.includes(template)) {
								ctx.ui.notify(`未知模板 ${arg}，可用：${LATEX_TEMPLATES.join("、")}`, "warning");
								return;
							}
							ctx.ui.notify(formatPaperInit(initPaperWorkspace(ctx.cwd, template)), "info");
						} else if (action === "check" || action === "final") {
							if (!config.manuscript || !existsSync(config.manuscript)) {
								ctx.ui.notify("没有稿件：先 /paper init，或在 2PI.md 中填写 稿件。", "warning");
								return;
							}
							const outcome = await checkFile(checkerScript, state, ctx.cwd, { path: config.manuscript, final: action === "final" });
							ctx.ui.notify(outcome.text, outcome.report.errors ? "warning" : "info");
						} else if (action === "compile") {
							const outcome = await compileProject(state, ctx.cwd, undefined);
							ctx.ui.notify(outcome.text, outcome.needsFix ? "warning" : "info");
						} else {
							ctx.ui.notify(
								[
									`稿件：${config.manuscript ? rel(config.manuscript) : "未设置"}`,
									`LaTeX 引擎：${detectEngine()?.engine ?? "无"}`,
									state.lastCheck
										? `最近检查：${rel(state.lastCheck.path)} — ${state.lastCheck.errors} 个错误，${state.lastCheck.warnings} 个警告`
										: "最近检查：无",
									state.lastCompile
										? `最近编译：${state.lastCompile.ok ? "成功" : "失败"}，${state.lastCompile.problems} 个问题`
										: "最近编译：无",
								].join("\n"),
								"info",
							);
						}
					} catch (error) {
						ctx.ui.notify(`论文：${error instanceof Error ? error.message : String(error)}`, "error");
					}
				},
			});
		},

		agentAreas: areas,

		guide() {
			return `${GUIDE}\n\n${referenceIndex(skill, [
				{ path: `${skill.assetsDir}/example_manuscript.md`, guide: "完整稿件示例（虚构研究，只示范写法与粒度）" },
				{ path: `${skill.assetsDir}/example_response_letter.md`, guide: "审稿回复信示例" },
			])}`;
		},

		stateLines(cwd) {
			const rel = (p: string) => slash(relative(cwd, p)) || p;
			const lines: string[] = [];
			if (state.lastCheck) {
				const c = state.lastCheck;
				lines.push(`论文最近检查：${rel(c.path)} — ${c.errors} 个错误、${c.warnings} 个警告${c.final ? "（投稿前检查）" : ""}。`);
			}
			if (state.lastCompile) {
				const c = state.lastCompile;
				lines.push(`论文最近编译：${rel(c.main)} — ${c.ok ? `成功${c.pages ? `，${c.pages} 页` : ""}` : "失败"}，${c.problems} 个问题。`);
			}
			if (state.unchecked.size > 0) lines.push(`改动后未检查：${[...state.unchecked.values()].map(rel).sort().join("、")}。`);
			if (state.uncompiled.size > 0) lines.push(`改动后未编译：${[...state.uncompiled.values()].map(rel).sort().join("、")}。`);
			return lines;
		},

		autoCheck(cwd, _core, signal) {
			return paperAutoCheck(checkerScript, state, cwd, signal);
		},

		doctor() {
			const group = "论文排版";
			const engine = detectEngine();
			const renderer = detectRenderer();
			return [
				engine
					? { group, name: "LaTeX", status: "ok", detail: `${engine.engine}（${engine.command}）` }
					: {
							group,
							name: "LaTeX",
							status: "fail",
							detail: "没有找到 tectonic 或 latexmk，论文无法编译成 PDF",
							fix: `安装 tectonic（推荐，单个程序）或 TeX Live / MiKTeX，或设置 ${ENV_PREFIX}TECTONIC / ${ENV_PREFIX}LATEXMK`,
						},
				renderer
					? { group, name: "PDF 预览", status: "ok", detail: `${renderer.kind}（${renderer.command}）` }
					: {
							group,
							name: "PDF 预览",
							status: "warn",
							detail: "没有找到 pdftoppm、mutool 或 Ghostscript，模型看不到编译后的页面",
							fix: "安装 poppler（TeX Live 自带 pdftoppm）、MuPDF 或 Ghostscript",
						},
			] satisfies DoctorCheck[];
		},

		pendingWork() {
			return [];
		},
	};
}
