import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { AGENT_ROOT, env, resolveSkillDir } from "../../core/config.ts";
import type { DoctorCheck } from "../../core/doctor.ts";
import { findSoffice } from "../../core/office.ts";
import { cleanPathArg, normalizePath, slash } from "../../core/paths.ts";
import { ledgerPath } from "../../core/project.ts";
import { loadSkill, referenceIndex } from "../../core/skill.ts";
import type { Pack } from "../types.ts";
import { patentBlocks } from "./blocks.ts";
import { registerPatentCommands } from "./commands.ts";
import { patentRedline } from "./redline.ts";
import { PatentState } from "./state.ts";
import { clip } from "../../core/python.ts";
import { registerBuildTool } from "./tools/build.ts";
import { checkAdvice, ledgerTraceText, registerCheckTool, runCheck } from "./tools/check.ts";

/** When to read each reference, in roughly the order a draft needs them. */
const REFERENCE_GUIDE: Record<string, string> = {
	"patentability-and-disclosure.md": "每次接手新论文都要读：公开状态、宽限期、技术属性（专利法第25条）、AI 发明充分公开要求",
	"input-requirements.md": "判断材料是否足够、怎样读 PDF 与图、缺口如何标注",
	"claims-drafting.md": "规划权利要求树、撰写或修改任何权利要求之前必读",
	"patent-drafting-standard.md": "撰写摘要、说明书各部分之前必读；含论文→专利的映射规则与充分公开核查（§7）",
	"drawing-generation.md": "设计说明书附图（drawings 节点与连线）之前必读",
	"document-generation.md": "patent.json 的字段契约；第一次写 JSON 之前必读",
	"quality-checklist.md": "交付前与 review 模式下逐项核对",
	"claims-and-specification-rules.md": "权利要求与说明书的形式规则速查",
	"text-conversion-workflow.md": "纯文本（text-only）输出时的结构与顺序",
};

const GUIDE = `本领域交付：说明书摘要、摘要附图、权利要求书、说明书、说明书附图（DOCX/PDF），另附一份独立的撰写说明（交接清单、公开风险、权利要求布局、支持关系）。

文件：
- 专利内容写在 patent/patent.json（同时转写多篇论文时用 patent/<简称>.patent.json）；附图与文件生成到 JSON 同目录的 out/。已有旧布局（工作目录根部的 patent.json）时沿用旧布局。
- 权利要求规划写入 patent.json 的 notes.claim_plan。

源事实：
- 同一项目里已有论文（paper/ 的 LaTeX 源）和证据账本（notes/evidence.json）时，以它们为源：读 LaTeX 源与 materials/ 原件，不要从编译出的 PDF 反解析；账本就是源事实清单，不再另写 notes/fact_sheet.md。
- 专利要用、账本里还没有的事实或数值（例如论文没写但 materials/ 里有的实现细节），先用 evidence 记账（类别与出处），再写进专利。账本中 missing 类的内容在专利里写成【待补充：…】。
- support_map 的每一项写成"E12 / 论文§3.1"的形式：账本条目编号加论文位置，让每个权利要求特征都能追到出处。
- 只有论文 PDF、没有账本时，源事实清单写入 notes/fact_sheet.md（每条注明出处：§、式、图、表）。
- patent_check 和本轮结束时的自动检查会把申请文本中的数值与账本逐个对账；找不到出处的数值要么补记账本，要么改为【待补充】。
- patent.json 是唯一事实来源：第一次整体写出，之后用 edit 局部修改，不要反复全量重写。字段契约见 document-generation.md，结构照抄示例 JSON。

工具对应关系（skill 与本 agent 的工具有出入时以此为准）：
- skill 第 6 步的四条脚本命令由工具完成：patent_check = check_patent_draft.py；patent_build = 附图 → DOCX → PDF 与预览页。不要手动运行这些脚本，除非工具报错需要排查。
- skill 中用 pdftotext / pdftoppm 读 PDF、渲染图页的步骤由 paper_ingest 完成。
- 构建后看版面：用 read 打开 patent_build 返回的附图与预览页 PNG（预览页分辨率不高，但足够判断版面）；只在需要看清某一页细节时才对那一页用 pdf_preview，不要整本高分辨率重渲染。
- skill 中不给用户看的内部材料（源事实清单、权利要求规划）写在文件里，不贴进对话。
- 用户没说模式时默认 direct：不为缺失信息停下来追问，用【待补充：…】标出并继续。项目卡 2PI.md 写了撰写模式或公开状态时以它为准。

交付消息：权利要求1依托的发明点（1–3 条）；权利要求结构（如"方法1–6 + 装置7 + 设备8 + 介质9"）；生成的文件路径；撰写说明第一节交接清单中最重要的 2–4 项；公开状态与新颖性风险的判断；提醒本稿是初稿、不是法律意见，提交前应由专利代理师复核并做现有技术检索。`;

function isPatentJson(path: string): boolean {
	if (!path.toLowerCase().endsWith(".json")) return false;
	const text = readFileSync(path, "utf8");
	try {
		const data = JSON.parse(text) as Record<string, unknown>;
		return typeof data === "object" && data !== null && ("claims" in data || "invention_name" in data);
	} catch {
		// A half-written or invalid patent JSON still needs a check; the checker reports the parse error.
		return /"(claims|invention_name)"\s*:/.test(text);
	}
}

export function createPatentPack(skillDir?: string): Pack {
	const skill = loadSkill(
		skillDir ??
			resolveSkillDir("paper2patent", "PATENT_SKILL_DIR", [
				join(AGENT_ROOT, "..", "skills", "paper2patent"),
				join(AGENT_ROOT, "skills", "paper2patent"),
			]),
		REFERENCE_GUIDE,
	);
	const state = new PatentState();
	const example = `${skill.assetsDir}/example_patent_content.json`;

	return {
		id: "patent",
		title: "论文 → 中国发明专利申请初稿",
		skill,
		blocks: patentBlocks,
		redline: patentRedline,

		detect(cwd) {
			if (existsSync(join(cwd, "patent", "patent.json")) || existsSync(join(cwd, "patent.json"))) return true;
			try {
				return readdirSync(cwd).some((name) => name.endsWith(".patent.json"));
			} catch {
				return false;
			}
		},

		register(pi) {
			registerCheckTool(pi, skill, state);
			registerBuildTool(pi, skill, state);
			registerPatentCommands(pi);
			pi.on("tool_result", (event, ctx) => {
				if (event.isError || (event.toolName !== "write" && event.toolName !== "edit")) return undefined;
				const raw = typeof event.input.path === "string" ? event.input.path : "";
				const path = resolve(ctx.cwd, cleanPathArg(raw));
				try {
					if (isPatentJson(path)) state.markJsonWritten(path);
				} catch {
					// Unreadable file: nothing to track.
				}
				return undefined;
			});
		},

		guide() {
			return `${GUIDE}\n\n${referenceIndex(skill, [
				{ path: example, guide: "一份完整、检查无误的 patent.json 示例（虚构发明，只示范字段、写法与粒度）" },
			])}`;
		},

		stateLines(cwd, core) {
			const rel = (path: string) => slash(relative(normalizePath(cwd), path)) || path;
			const lines: string[] = [];
			if (core.activePacks(cwd).includes("patent") && existsSync(join(cwd, "paper", "main.tex")) && existsSync(ledgerPath(cwd))) {
				lines.push("专利源事实：本项目有论文 LaTeX 源与证据账本，转写专利时以它们为源（见 guide_patent）。");
			}
			for (const [path, record] of state.lastCheck) {
				if (!state.dirtyJson.has(path)) {
					lines.push(`专利 ${rel(path)}：最近一次检查 ${record.errors} 个 ERROR、${record.warnings} 个 WARN。`);
				}
			}
			if (state.dirtyJson.size > 0) lines.push(`专利 JSON 改动后未检查：${[...state.dirtyJson].map(rel).join("、")}。`);
			return lines;
		},

		agentAreas(cwd) {
			const areas = [join(cwd, "patent"), join(cwd, "patent.json"), join(cwd, "notes", "fact_sheet.md")];
			try {
				for (const name of readdirSync(cwd)) if (name.endsWith(".patent.json")) areas.push(join(cwd, name));
			} catch {
				// unreadable directory: no extra areas
			}
			return areas;
		},

		/** Check every patent JSON changed in this turn; keep reporting drafts that still have ERRORs. */
		async autoCheck(cwd, _core, signal) {
			const parts: string[] = [];
			const checked = new Set<string>();
			let needsFix = false;
			for (const path of [...state.dirtyJson]) {
				checked.add(path);
				try {
					const outcome = await runCheck(skill, state, path, signal);
					const trace = ledgerTraceText(cwd, path);
					parts.push([slash(path), clip(outcome.report, 4000), checkAdvice(outcome), ...(trace ? [trace] : [])].join("\n"));
					needsFix ||= outcome.errors > 0;
				} catch (error) {
					state.dirtyJson.delete(path);
					parts.push(`${slash(path)} 检查未能运行：${error instanceof Error ? error.message : String(error)}`);
				}
			}
			for (const [path, record] of state.lastCheck) {
				if (record.errors > 0 && !checked.has(path)) {
					parts.push(`${slash(path)} 最近一次检查仍有 ${record.errors} 个 ERROR，运行 patent_check 查看并修复。`);
					needsFix = true;
				}
			}
			if (parts.length === 0) return undefined;
			return { text: ["专利：本轮修改后的自动检查", ...parts].join("\n\n"), needsFix };
		},

		doctor() {
			const group = "专利文件";
			const soffice = findSoffice();
			if (soffice) return [{ group, name: "DOCX → PDF", status: "ok", detail: `LibreOffice（${soffice}）` }];
			if (process.platform === "win32" && !env("NO_WORD")) {
				return [
					{
						group,
						name: "DOCX → PDF",
						status: "warn",
						detail: "没有找到 LibreOffice，将尝试用 Microsoft Word 导出（需要已安装 Word）",
						fix: "安装 LibreOffice 更稳定，或设置环境变量 SOFFICE 指向 soffice.exe",
					},
				] satisfies DoctorCheck[];
			}
			return [
				{
					group,
					name: "DOCX → PDF",
					status: "warn",
					detail: "没有找到 LibreOffice，只能生成以图片为页面的审阅 PDF",
					fix: "安装 LibreOffice，或设置环境变量 SOFFICE 指向 soffice",
				},
			] satisfies DoctorCheck[];
		},

		pendingWork(core) {
			const items: string[] = [];
			const unseen = state.builtImages.drawings.filter((path) => !core.hasViewed(path));
			if (unseen.length > 0) items.push(`还有 ${unseen.length} 张附图没有查看：${unseen.map(slash).join("、")}`);
			const { previews, pdfs } = state.builtImages;
			const pdfSeen = pdfs.some((path) => core.hasViewed(path)) || previews.some((path) => core.hasViewed(path));
			if (previews.length > 0 && !pdfSeen) {
				items.push(`PDF 预览页一张都没有查看（${slash(previews[0] ?? "")} 等，或用 pdf_preview 查看 PDF）。`);
			}
			return items;
		},
	};
}
