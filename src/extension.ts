import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type ExtensionAPI, type ExtensionFactory, getAgentDir, type Skill } from "@earendil-works/pi-coding-agent";
import { registerCoreCommands } from "./core/commands.ts";
import { AGENT_ROOT, AGENT_TITLE } from "./core/config.ts";
import { ledgerSummary, loadLedger } from "./core/evidence.ts";
import { installGate } from "./core/gate.ts";
import { installGuard, type WriteContext } from "./core/guard.ts";
import { registerChangesCommand } from "./core/changes-view.ts";
import { describeChange, History, installHistory } from "./core/history.ts";
import { isInside, normalizePath, slash } from "./core/paths.ts";
import {
	LEGACY_PAPER_FILE,
	ledgerPath,
	PROJECT_FILE,
	type ProjectCard,
	readProjectCard,
	readProjectFields,
	SCRATCH_DIR,
} from "./core/project.ts";
import { domainSections, PREAMBLE, toolsSection, workspaceSection } from "./core/prompt.ts";
import { installReconnect, type ReconnectOptions } from "./core/reconnect.ts";
import { CoreState } from "./core/state.ts";
import { registerAskUserTool } from "./core/tools/ask-user.ts";
import { computeStatsTool } from "./core/tools/compute-stats.ts";
import { evidenceTool } from "./core/tools/evidence.ts";
import { registerIngestTool } from "./core/tools/paper-ingest.ts";
import { pdfPreviewTool } from "./core/tools/pdf-preview.ts";
import { registerRedline } from "./core/tools/redline.ts";
import { registerReportChangesTool } from "./core/tools/report-changes.ts";
import { registerPlanTool } from "./core/tools/update-plan.ts";
import { createPaperPack } from "./packs/paper/index.ts";
import { createPatentPack } from "./packs/patent/index.ts";
import { createResearchPack } from "./packs/research/index.ts";
import { retryBudget } from "./ui/defaults.ts";
import { installUi } from "./ui/index.ts";
import type { Pack } from "./packs/types.ts";

export interface TwoPiOptions {
	/** Domain packs to load; defaults to every pack 2pi ships. */
	packs?: () => Pack[];
	/** Which discovered pi skills to keep listing in the prompt. Default: all. */
	keepSkill?: (skill: Skill) => boolean;
	/** How the network wait probes and sleeps (tests replace both). */
	reconnect?: Pick<ReconnectOptions, "probe" | "sleep" | "random">;
}

/** Every pack 2pi ships. */
export function defaultPacks(): Pack[] {
	return [createPaperPack(), createPatentPack(), createResearchPack()];
}

/**
 * Which packs the project uses: the project card decides; without one, the artifacts already in
 * the directory; with a single domain installed, that domain. Otherwise the model chooses.
 * Auxiliary packs (research) join whenever their artifacts exist.
 */
export function resolveActivePacks(cwd: string, packs: Pack[], card: ProjectCard): { active: Pack[]; source: string } {
	const domains = packs.filter((pack) => !pack.auxiliary);
	const extra = packs.filter((pack) => pack.auxiliary && pack.detect(cwd));
	const result = (active: Pack[], source: string) => ({ active: [...active, ...extra], source });
	if (card.type) {
		const wanted = card.type === "both" ? ["paper", "patent"] : [card.type];
		return result(domains.filter((pack) => wanted.includes(pack.id)), `项目卡 2PI.md（类型 ${card.type}）`);
	}
	const detected = domains.filter((pack) => pack.detect(cwd));
	if (detected.length > 0) return result(detected, "没有项目卡，按现有文件判断");
	if (domains.length === 1) return result(domains, "没有项目卡，只安装了这一个领域");
	return result([], "没有项目卡，领域未确定");
}

/**
 * The launcher's skill filter. pi also discovers the user's general-purpose skills on its own (e.g.
 * ~/.agents/skills); 2pi does not list those. It keeps project skills, --skill paths, skills listed
 * in settings, package skills, and skills in 2pi's own config directory.
 */
export function keepTwoPiSkill(skill: Skill, agentDir: string | undefined): boolean {
	const { scope, source } = skill.sourceInfo;
	return scope !== "user" || source !== "auto" || (!!agentDir && isInside(skill.filePath, agentDir));
}

function projectState(
	cwd: string,
	card: ProjectCard,
	active: Pack[],
	source: string,
	history: History,
	packs: Pack[],
	core: CoreState,
): string {
	const lines = [
		`领域：${active.length > 0 ? active.map((pack) => pack.id).join("、") : "未确定"}（${source}）。`,
		`联网检索：${card.onlineSearch ? "项目卡允许" : "未获项目卡允许，不要把论文内容或未公开的想法发给第三方检索服务"}。`,
	];
	if (card.type && !active.some((pack) => !pack.auxiliary)) lines.push(`项目卡要求的领域（${card.type}）尚未安装，告诉用户这一点。`);
	const ledger = ledgerPath(cwd);
	if (existsSync(ledger)) {
		let summary: string;
		try {
			summary = ledgerSummary(loadLedger(ledger));
		} catch (error) {
			summary = `不是合法的 JSON（${error instanceof Error ? error.message : String(error)}），请修复`;
		}
		lines.push(`证据账本 ${slash(relative(cwd, ledger))}：${summary}。`);
	}
	const checkpoints = history.checkpoints;
	if (checkpoints.disabledReason) {
		lines.push(`检查点：已关闭（${checkpoints.disabledReason}）。`);
	} else {
		const last = history.changes.list().at(-1);
		lines.push(
			last
				? `上一轮修改（${last.id}${last.undoneBy ? "，已被撤回" : ""}）：${describeChange(last, 5)}。`
				: "检查点：每轮修改自动存档，用户可 /undo 撤回。",
		);
	}
	for (const pack of packs) lines.push(...pack.stateLines(cwd, core));
	return lines.join("\n");
}

/** The pi extension that turns the generic harness into 2pi. */
export function createTwoPiExtension(options: TwoPiOptions = {}): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		const packs = options.packs?.() ?? defaultPacks();
		const core = new CoreState([AGENT_ROOT, ...packs.map((pack) => pack.skill.dir)]);
		core.activePacks = (cwd) => resolveActivePacks(cwd, packs, readProjectCard(cwd)).active.map((pack) => pack.id);
		const extractors = packs.flatMap((pack) => (pack.blocks ? [pack.blocks] : []));
		let history: History | undefined;
		const getHistory = (cwd: string): History =>
			history && normalizePath(history.checkpoints.cwd) === normalizePath(cwd)
				? history
				: (history = new History(cwd, extractors));
		// A turn that changed a draft owes the reviewer an account of what changed and why.
		const unexplained = (cwd: string): string[] => {
			const files = getHistory(cwd).owesReport(extractors);
			return files.length > 0
				? [`本轮修改了 ${files.join("、")}，还没有用 report_changes 说明改了什么、为什么（会显示在修改记录、审阅页和修订稿中）。`]
				: [];
		};

		const writeContext = (cwd: string): WriteContext => {
			const card = readProjectCard(cwd);
			return {
				cwd,
				core,
				materials: join(cwd, readProjectFields(cwd).materials ?? "materials"),
				agentAreas: [
					join(cwd, SCRATCH_DIR),
					join(cwd, PROJECT_FILE),
					join(cwd, LEGACY_PAPER_FILE),
					ledgerPath(cwd),
					// A project 2pi set up keeps its working notes in notes/; elsewhere notes/ may be the author's.
					...(card.path ? [join(cwd, "notes")] : []),
					...packs.flatMap((pack) => pack.agentAreas(cwd)),
				],
				touchedBefore: (path) => {
					const changes = getHistory(cwd).changes.list().filter((change) => !change.prompt.startsWith("/undo"));
					return changes.some((change) =>
						change.files.some((file) => isInside(path, join(cwd, file.path)) && file.status !== "deleted"),
					);
				},
			};
		};

		const ui = installUi(pi, {
			domains: (cwd) => resolveActivePacks(cwd, packs, readProjectCard(cwd)).active.map((pack) => pack.id),
		});
		registerIngestTool(pi, core);
		registerPlanTool(pi, {
			onPlan: (plan) => {
				ui.flow.plan = plan;
				ui.planChanged();
			},
			shownElsewhere: () => ui.panelVisible(),
		});
		registerAskUserTool(pi);
		registerReportChangesTool(pi, getHistory);
		registerRedline(pi, getHistory, packs);
		pi.registerTool(evidenceTool);
		pi.registerTool(computeStatsTool);
		pi.registerTool(pdfPreviewTool);
		for (const pack of packs) pack.register(pi, core);
		installGuard(pi, core, writeContext);
		installGate(pi, core, packs, unexplained, (outcome) => ui.gate(outcome));
		installReconnect(pi, {
			...options.reconnect,
			onStatus: (status) => ui.network(status),
			retryBudget: () => retryBudget(getAgentDir()),
		});
		installHistory(pi, getHistory);
		registerChangesCommand(pi, getHistory);
		registerCoreCommands(pi, packs);

		// Replace pi's coding prompt with the layered 2pi prompt (see core/prompt.ts). On the first
		// prompt this becomes the session's initial system message; later runs only send changes.
		pi.on("before_agent_start", (event, ctx) => {
			const prompt = event.systemPromptOptions;
			const card = readProjectCard(ctx.cwd);
			const { active, source } = resolveActivePacks(ctx.cwd, packs, card);
			prompt.customPrompt = PREAMBLE;
			// Pack skills are inlined in full; other discovered skills only when the launcher keeps them.
			const packSkills = new Set(packs.map((pack) => pack.skill.name));
			prompt.skills = prompt.skills.filter(
				(skill) => !packSkills.has(skill.name) && (options.keepSkill?.(skill) ?? true),
			);
			// Instructions from parent directories (e.g. a repository's CLAUDE.md for coding agents) are
			// not about this project; keep the project's own context files and the 2pi agent directory's.
			const agentDir = getAgentDir();
			prompt.contextFiles = prompt.contextFiles.filter(
				(file) => isInside(file.path, ctx.cwd) || isInside(file.path, agentDir),
			);
			const cards = [card.path, join(ctx.cwd, LEGACY_PAPER_FILE)].filter((path): path is string => !!path && existsSync(path));
			for (const path of cards) {
				if (!prompt.contextFiles.some((file) => normalizePath(file.path) === normalizePath(path))) {
					const content = path === card.path ? card.content : undefined;
					prompt.contextFiles.push({ path: slash(path), content: content ?? readProjectFile(path) });
				}
			}
			Object.assign(prompt.sections, {
				tools: toolsSection(prompt, pi.getActiveTools()),
				workspace: workspaceSection(ctx.cwd),
				...domainSections(packs, active, ctx.cwd),
				project_state: projectState(ctx.cwd, card, active, source, getHistory(ctx.cwd), packs, core),
			});
			return undefined;
		});

		pi.on("session_start", (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.setTitle(`${AGENT_TITLE} · ${slash(ctx.cwd).split("/").pop() ?? ""}`);
		});
	};
}

function readProjectFile(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}
