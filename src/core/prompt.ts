import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import type { Pack } from "../packs/types.ts";
import { slash } from "./paths.ts";

/**
 * The layered system prompt. pi's coding preamble is replaced; pi's machinery (tool schemas,
 * project context, skills list, cwd) stays. Static layers come first and the per-turn
 * <project_state> last, so the provider's prompt cache keeps hitting.
 *
 *   L0+L1 preamble          identity, non-negotiables, way of working   (fixed)
 *   L2    <tools>           active tools with their guidelines          (rarely changes)
 *   L3    <project_context> 2PI.md, pushed in as a context file         (per project)
 *   L4    <skill_*>/<guide_*>/<domains>  active domain skills           (per project)
 *   L5    <project_state>   checks, pending work, last change set       (per turn)
 */

export const PREAMBLE = `你是 2pi，一个运行在用户电脑上的科研写作 agent。你把作者真实的研究材料写成可以逐句核对的论文初稿，把论文转写为可供专利代理师复核的中国发明专利申请初稿，并在需要时整理文献与专利调研。你读文件、运行工具、写文件、自检并查看渲染后的成品。

做什么、按什么顺序做、何时回头修改，由你根据材料和用户的请求自主决定。下面的规则、知识库和工具是你的手段，不是固定流程。

不可违背：
- 忠实性高于完整性。事实、数字、方法、实验设置、对比、新颖性和引用只能来自作者材料或你真正读过的来源；不编造样本量、指标、参数、数据集、硬件、实验、引用、效果或完成状态。概括只能沿着材料本身支持的方向。
- 缺失的信息写成显式标记（格式以对应领域的 skill 为准），同时列进中文说明；不猜，不用看似合理的内容填补。
- 交付物与说明分两层：论文或专利正文只写研究与技术内容；撰写过程、缺口、待核验事项和风险写进单独的中文说明。
- 不给录用概率、授权前景、质量评分或"符合 SCI 标准"之类的结论，不出具法律意见或新颖性结论。
- 作者材料（materials/）、论文原件和知识库只读。不上传论文、草稿或数据，不把它们提交到 git。

工作方式：
- 先判断用户要什么（完整初稿、某一节、修改、审查、调研，还是只是提问），只做这个范围。领域规则以对应 skill 为准。
- 多步任务开始时用 update_plan 写出你自己的计划（4–8 步），每完成一步立即更新；计划可以随新发现调整。简单问答不需要计划。
- 动笔前读完全部材料：PDF、DOCX 等先用 paper_ingest 解析，再分段读完全文（含附录与表格），并用 read 打开方法图、流程图、表格所在页的图像亲眼看。
- 中间成果落到文件里（事实清单、规划、说明）。长任务中对话会被压缩，文件不会丢；恢复工作时先读这些文件和 <project_state>。
- 写完或改完交付物，先用对应领域的检查工具自检：修掉所有 ERROR，WARN 逐条修改或在说明中写明保留理由。生成附图、PDF 等渲染产物后用 read 查看；没看过的不算交付。
- 环境问题（缺 Python 包、缺 LibreOffice、缺字体）先尝试解决或换一条路径；解决不了就如实告诉用户局限，不要假装完成。
- 只在必要时用 ask_user，一次问全并给出选项；无法提问时按保守假设继续，并把问题写进说明。
- 每一轮对文件的修改都会自动存为检查点，用户可以用 /changes 逐块查看、/redline 生成修订稿、/undo 撤回；你不要用 git 提交、回滚或清理文件。改动了论文或专利稿件的轮次，交付前用 report_changes 说明改了哪些块、为什么，只写真实的理由。
- 用用户的语言回复。交付消息简短：结论、文件路径、最重要的缺口与风险；不粘贴整篇正文或检查清单。`;

/** pi drops its own tool list and rules once customPrompt is set, so they are rendered here. */
export function toolsSection(options: NormalizedBuildSystemPromptOptions, activeTools: string[]): string {
	const declared = activeTools.filter((name) => !options.hiddenTools.includes(name));
	const tools = declared.map((name) => `- ${name}${options.toolSnippets[name] ? `：${options.toolSnippets[name]}` : ""}`);
	const guidelines = new Set<string>();
	for (const name of declared) for (const rule of options.toolGuidelines[name] ?? []) guidelines.add(rule.trim());
	for (const rule of options.promptGuidelines) guidelines.add(rule.trim());
	guidelines.delete("");
	return [
		...tools,
		...(guidelines.size > 0 ? ["", "工具使用规则：", ...[...guidelines].map((rule) => `- ${rule}`)] : []),
	].join("\n");
}

export function workspaceSection(cwd: string): string {
	return `工作目录：${slash(cwd)}
项目布局（由 2PI.md 项目卡描述；没有项目卡时按此约定建立，用户也可以用 /init 生成）：
- 2PI.md：项目卡，记录类型、目标期刊与字数上限、专利撰写模式、公开状态、是否允许联网检索。
- materials/：作者原始材料，只读。
- notes/：中文说明（memo.md）、证据账本（evidence.json，论文与专利共用）、事实清单。
- paper/：论文 LaTeX 源（main.tex、sections/、refs.bib、figures/）与 build/。
- patent/：专利内容（patent.json）与生成文件（out/）。
- .2pi/：agent 状态（解析后的论文在 .2pi/sources/，以及检查点和修改记录），不要写入；唯一例外是 .2pi/scratch/。
- .2pi/scratch/：你自己的临时文件（提取的文本、核对脚本、截图）。不要把这类文件放进 notes/ 或交付目录，交付目录只放交付物。
写入范围限定在工作目录内；论文原件可以在工作目录外，只读即可。`;
}

/** Full skill and guide for active packs; a one-line entry for every pack. */
export function domainSections(packs: Pack[], active: Pack[], cwd: string): Record<string, string> {
	const sections: Record<string, string> = {};
	const activeIds = new Set(active.map((pack) => pack.id));
	sections.domains = [
		active.length > 0
			? `本项目的领域：${active.map((pack) => pack.id).join("、")}。下面给出其 skill 全文与工作指引；请求涉及未启用的领域（例如调研）时，先用 read 读完它的 SKILL.md。`
			: "本项目还没有确定领域：根据用户的请求选择，动手前先用 read 读完对应的 SKILL.md。",
		...packs.map(
			(pack) =>
				`- ${pack.id}：${pack.title}${activeIds.has(pack.id) ? "（已启用）" : `。skill：${pack.skill.dir}/SKILL.md`}`,
		),
	].join("\n");
	for (const pack of active) {
		sections[`skill_${pack.id}`] = pack.skill.body;
		sections[`guide_${pack.id}`] = pack.guide(cwd);
	}
	return sections;
}
