import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FauxResponseStep, fauxProvider } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createTwoPiExtension, type TwoPiOptions } from "../src/extension.ts";
import { createPatentPack } from "../src/packs/patent/index.ts";

// Deterministic builds: the image-based PDF fallback instead of driving Microsoft Word.
process.env.TWOPI_NO_WORD = "1";

export const patentSkillDir = (): string => createPatentPack().skill.dir;

export interface TestAgent {
	session: AgentSession;
	root: string;
	cwd: string;
	setResponses(responses: FauxResponseStep[]): void;
	pendingResponses(): number;
	cleanup(): void;
}

export interface TestAgentOptions {
	/** Load AGENTS.md/CLAUDE.md context files (off by default). */
	contextFiles?: boolean;
	/** Files to create in the workspace before the session starts. */
	files?: Record<string, string>;
	/** How extensions see the session; default "json" (every message is visible, as for SDK users). */
	mode?: "json" | "print";
	/** Options for the 2pi extension. */
	extension?: TwoPiOptions;
}

/** A real AgentSession with the 2pi extension, driven by scripted faux model replies. */
export async function createTestAgent(options: TestAgentOptions = {}): Promise<TestAgent> {
	const root = mkdtempSync(join(tmpdir(), "2pi-test-"));
	const cwd = join(root, "workspace");
	const agentDir = join(root, "agent-home");
	mkdirSync(cwd, { recursive: true });
	for (const [path, content] of Object.entries(options.files ?? {})) {
		mkdirSync(join(cwd, path, ".."), { recursive: true });
		writeFileSync(join(cwd, path), content);
	}
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const faux = fauxProvider();
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noContextFiles: !options.contextFiles,
		extensionFactories: [(pi) => pi.registerProvider(faux.provider), createTwoPiExtension(options.extension)],
	});
	await resourceLoader.reload();
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		refreshOnCreate: false,
	});
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: faux.getModel(),
		settingsManager,
		sessionManager: SessionManager.inMemory(cwd),
		modelRuntime,
		resourceLoader,
	});
	await session.bindExtensions({ mode: options.mode ?? "json" });
	return {
		session,
		root,
		cwd,
		setResponses: (responses) => faux.setResponses(responses),
		pendingResponses: () => faux.getPendingResponseCount(),
		cleanup: () => {
			session.dispose();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

export function copyExample(cwd: string, name = "patent/patent.json"): string {
	const target = join(cwd, name);
	mkdirSync(join(target, ".."), { recursive: true });
	copyFileSync(join(patentSkillDir(), "assets", "example_patent_content.json"), target);
	return target;
}

export function textOf(message: unknown): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}

export function toolResults(session: AgentSession, toolName: string) {
	return session.messages.filter(
		(message): message is Extract<typeof message, { role: "toolResult" }> =>
			message.role === "toolResult" && message.toolName === toolName,
	);
}

export function customMessages(session: AgentSession, customType: string) {
	return session.messages.filter((message) => message.role === "custom" && message.customType === customType);
}

/** Minimal text PDF (Helvetica, one text block per page) for ingest tests. */
export function writeTextPdf(path: string, pages: string[][]): void {
	const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);
	const objects: string[] = [];
	const pageIds: number[] = [];
	const fontId = 3 + pages.length * 2;
	pages.forEach((lines, index) => {
		const pageId = 3 + index * 2;
		pageIds.push(pageId);
		const stream = `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((line) => `(${escape(line)}) Tj T*`).join(" ")} ET`;
		objects[pageId] =
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageId + 1} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
		objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
	});
	objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
	objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
	objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
	let body = "%PDF-1.4\n";
	const offsets: number[] = [];
	for (let id = 1; id < objects.length; id++) {
		offsets[id] = body.length;
		body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
	}
	const xref = body.length;
	body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
	for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
	body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	writeFileSync(path, body, "latin1");
}
