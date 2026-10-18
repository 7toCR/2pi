import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BlockExtractor } from "../core/blocks.ts";
import type { DoctorCheck, DoctorOptions } from "../core/doctor.ts";
import type { RedlineContext, RedlineOutput } from "../core/redline.ts";
import type { SkillKnowledge } from "../core/skill.ts";
import type { CoreState } from "../core/state.ts";

/** What a pack's end-of-turn checks found. `needsFix` starts an automatic fix round. */
export interface GateReport {
	text: string;
	needsFix: boolean;
}

/**
 * A domain pack plugs one kind of deliverable into the shared core: its skill (the rules), its
 * tools, what it adds to the prompt, and what must be verified before the agent delivers.
 */
export interface Pack {
	/** Matches the project card's type ("paper", "patent"); auxiliary packs have their own id. */
	id: "paper" | "patent" | "research";
	/** One line for the model and the user, e.g. "论文 → 中国发明专利申请初稿". */
	title: string;
	skill: SkillKnowledge;
	/**
	 * Serves the main domains rather than being a project type (research serves papers and
	 * patents alike): active whenever detect() finds its artifacts, whatever the project card says.
	 */
	auxiliary?: boolean;
	/** The workspace already holds this pack's artifacts (used when there is no project card). */
	detect(cwd: string): boolean;
	/** Register tools, commands, and event handlers. Called once per extension load. */
	register(pi: ExtensionAPI, core: CoreState): void;
	/** Create this domain's part of a new project. Existing files are never overwritten. */
	init?(cwd: string): string[];
	/**
	 * Files and folders this pack's drafts live in. Elsewhere in the project, an existing file may
	 * be the author's original, so changing it needs the user's confirmation.
	 */
	agentAreas(cwd: string): string[];
	/** Prompt text beyond the skill: tool mapping, file layout, delivery message. */
	guide(cwd: string): string;
	/** Lines for the dynamic <project_state> section. */
	stateLines(cwd: string, core: CoreState): string[];
	/**
	 * Checks the harness runs itself when the agent is about to stop (e.g. compile and check the
	 * drafts changed in this turn). Undefined when nothing needs checking.
	 */
	autoCheck?(cwd: string, core: CoreState, signal: AbortSignal | undefined): Promise<GateReport | undefined>;
	/** Verification only the model can do (e.g. look at rendered drawings); empty when none. */
	pendingWork(core: CoreState): string[];
	/** Split this domain's documents into reviewable blocks (claims, paragraphs) for change views. */
	blocks?: BlockExtractor;
	/** /doctor: this pack's tools and services, checked for real (network checks send fixed test requests only). */
	doctor?(cwd: string, options: DoctorOptions): Promise<DoctorCheck[]> | DoctorCheck[];
	/** Redline documents for a range of turns (e.g. a latexdiff PDF, a tracked-changes DOCX). */
	redline?(context: RedlineContext): Promise<RedlineOutput[]>;
}
