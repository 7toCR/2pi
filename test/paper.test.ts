/**
 * The paper pack in real sessions driven by the faux model, ported from research2paper's session,
 * gate, evidence, fill_gaps, guard, compile and P3 tests. LaTeX tests run with whichever engine is
 * installed (tectonic or latexmk) and are skipped when there is none.
 */

import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage, getSystemMessageText } from "@earendil-works/pi-ai";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { loadLedger } from "../src/core/evidence.ts";
import { GATE_MESSAGE } from "../src/core/gate.ts";
import { detectRenderer } from "../src/core/pdf.ts";
import { pdfPreviewTool } from "../src/core/tools/pdf-preview.ts";
import { checkFile } from "../src/packs/paper/checker.ts";
import { initPaperWorkspace, LATEX_TEMPLATES } from "../src/packs/paper/config.ts";
import { compileProject, detectEngine } from "../src/packs/paper/latex.ts";
import { PaperState } from "../src/packs/paper/state.ts";
import { createBibLookupTool } from "../src/packs/paper/tools.ts";
import { BIB, mockFetch } from "./fixtures/crossref.ts";
import { createTestAgent, customMessages, textOf, toolResults } from "./helpers.ts";

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const say = (text: string) => fauxAssistantMessage(text);
const FIXTURE = join(import.meta.dirname, "fixtures", "flawed_manuscript.md");
const CHECKER = join(import.meta.dirname, "..", "skills", "research2paper", "scripts", "check_paper_draft.py");
const PAPER_CARD = "# 2pi 项目卡\n\n- 类型：paper\n- 目标期刊：Synthetic Journal of Tests\n";
const gates = (agent: Awaited<ReturnType<typeof createTestAgent>>) => customMessages(agent.session, GATE_MESSAGE).map(textOf);
const toolCtx = (cwd: string) => ({ cwd }) as unknown as ExtensionToolContext;

describe("paper project", () => {
	test("the prompt carries the paper skill and guide; check_draft runs the checker; nothing written, no gate", async () => {
		const agent = await createTestAgent({ files: { "2PI.md": PAPER_CARD } });
		try {
			copyFileSync(FIXTURE, join(agent.cwd, "draft.md"));
			agent.setResponses([call("check_draft", { path: "draft.md" }), say("Checked.")]);
			await agent.session.prompt("Check draft.md");
			const head = getCurrentSystemMessage(agent.session.messages);
			assert.ok(head);
			const prompt = getSystemMessageText(head);
			const sections = Object.keys(head.sections ?? {});
			assert.ok(sections.includes("skill_paper") && sections.includes("guide_paper"));
			assert.ok(!sections.includes("skill_patent"));
			assert.match(prompt, /# Research2Paper/);
			assert.match(prompt, /Synthetic Journal of Tests/);
			assert.match(prompt, /- check_draft：Run the Research2Paper draft checker/);
			const result = textOf(toolResults(agent.session, "check_draft").at(-1));
			assert.match(result, /4 error\(s\)/);
			assert.match(result, /G01/);
			assert.equal(gates(agent).length, 0);
		} finally {
			agent.cleanup();
		}
	});

	test("an ERROR starts a fix round; a clean re-check ends the turn", async () => {
		const agent = await createTestAgent({ files: { "2PI.md": PAPER_CARD } });
		try {
			agent.setResponses([
				call("write", { path: "draft.md", content: "# Synthetic Title\n\nThe stride is [MISSING].\n" }),
				say("Drafted."),
				(context) => {
					const last = JSON.stringify(context.messages.at(-1));
					assert.match(last, /G01/);
					assert.match(last, /自动修复轮 1\/2/);
					return call("write", { path: "draft.md", content: "# Synthetic Title\n\nThe stride is [MISSING: stride of the sliding window].\n" });
				},
				say("Fixed the marker."),
			]);
			await agent.session.prompt("Draft the methods paragraph");
			assert.equal(agent.pendingResponses(), 0);
			const reports = gates(agent);
			assert.equal(reports.length, 2);
			assert.match(reports[0] ?? "", /1 error\(s\)/);
			assert.match(reports[1] ?? "", /0 error\(s\)/);
			assert.match(reports[1] ?? "", /没有阻断性问题/);
		} finally {
			agent.cleanup();
		}
	});

	test("fill_gaps fills LaTeX sections in place and removes their 材料缺口 lines from the notes", async () => {
		const agent = await createTestAgent();
		try {
			initPaperWorkspace(agent.cwd, "article");
			const methods = join(agent.cwd, "paper", "sections", "methods.tex");
			writeFileSync(methods, "\\section{Methods}\nThe window stride is [MISSING: stride of the sliding window].\n");
			const memo = join(agent.cwd, "notes", "memo.md");
			writeFileSync(memo, "# 中文说明\n\n## 材料缺口\n\n- `[MISSING: stride of the sliding window]`：请提供滑窗步长。\n- `[MISSING: title]`：题目最后确定。\n");
			agent.setResponses([
				call("fill_gaps", { values: { "[MISSING: stride of the sliding window]": "16 samples" } }),
				say("Filled."),
				say("Done."),
				say("Done."),
			]);
			await agent.session.prompt("The stride is 16 samples");
			assert.equal(readFileSync(methods, "utf8"), "\\section{Methods}\nThe window stride is 16 samples.\n");
			const notes = readFileSync(memo, "utf8");
			assert.doesNotMatch(notes, /stride of the sliding window/);
			assert.match(notes, /\[MISSING: title\]/);
			// The filled manuscript goes through the end-of-turn compile and check.
			assert.ok(gates(agent).length >= 1);
		} finally {
			agent.cleanup();
		}
	});

	test("guard: materials are read-only; an author file outside the drafts is not overwritten without a yes", async () => {
		const agent = await createTestAgent({
			files: { "materials/results.csv": "method,correct\nA,160\n", "intro.md": "# Introduction\n\nAuthor text.\n" },
		});
		try {
			agent.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("write", { path: "materials/results.csv", content: "tampered" }),
						fauxToolCall("bash", { command: "rm materials/results.csv" }),
						fauxToolCall("edit", { path: "intro.md", edits: [{ oldText: "Author text.", newText: "New text." }] }),
						fauxToolCall("write", { path: "intro.revised.md", content: "# Introduction\n\nNew text.\n" }),
					],
					{ stopReason: "toolUse" },
				),
				say("Done."),
				say("Done."),
				say("Done."),
			]);
			await agent.session.prompt("Revise the introduction");
			const results = agent.session.messages.filter((m) => m.role === "toolResult").map(textOf);
			assert.equal(results.length, 4);
			assert.match(results[0] ?? "", /只读/);
			assert.match(results[1] ?? "", /materials/);
			assert.match(results[2] ?? "", /可能是作者的原始文件/);
			assert.equal(readFileSync(join(agent.cwd, "materials", "results.csv"), "utf8"), "method,correct\nA,160\n");
			assert.equal(readFileSync(join(agent.cwd, "intro.md"), "utf8"), "# Introduction\n\nAuthor text.\n");
			assert.ok(existsSync(join(agent.cwd, "intro.revised.md")));
		} finally {
			agent.cleanup();
		}
	});

	test("bib_lookup reads the project bibliography, never edits it, and writes a report", async () => {
		const agent = await createTestAgent();
		try {
			initPaperWorkspace(agent.cwd, "article");
			const bibPath = join(agent.cwd, "paper", "refs.bib");
			writeFileSync(bibPath, BIB);
			const tool = createBibLookupTool(mockFetch);
			const result = await tool.execute("t1", { keys: ["doe2020", "nodoi2022"], search: true }, undefined, undefined, toolCtx(agent.cwd));
			assert.match(textOf(result), /Checked 2 entries: 1 record-matches, 1 no-doi/);
			assert.equal(readFileSync(bibPath, "utf8"), BIB);
			assert.ok(existsSync(join(agent.cwd, ".2pi", "reports")));
		} finally {
			agent.cleanup();
		}
	});
});

const engine = detectEngine();
const renderer = detectRenderer();

describe(`paper with LaTeX (${engine?.engine ?? "no engine"})`, { skip: engine ? false : "no LaTeX engine (tectonic or latexmk)" }, () => {
	test("every skeleton compiles and passes the checker without errors", async () => {
		for (const template of LATEX_TEMPLATES) {
			const agent = await createTestAgent();
			try {
				initPaperWorkspace(agent.cwd, template);
				const state = new PaperState();
				const compiled = await compileProject(state, agent.cwd, undefined);
				assert.ok(compiled.result?.ok, `${template}: ${compiled.text}`);
				assert.equal(compiled.needsFix, false, compiled.text);
				const checked = await checkFile(CHECKER, state, agent.cwd, { path: "paper/main.tex" });
				assert.equal(checked.report.errors, 0, checked.text);
			} finally {
				agent.cleanup();
			}
		}
	});

	test("compute_stats and evidence fill the ledger; the gate compiles, checks and reports untraced numbers (V01)", async () => {
		const agent = await createTestAgent();
		try {
			initPaperWorkspace(agent.cwd, "article");
			writeFileSync(join(agent.cwd, "materials", "results.csv"), "method,test_signals,correctly_denoised\nSWD,200,160\nBaseline B,200,150\n");
			const cell = (row: string, column: string) => ({ file: "materials/results.csv", row, column });
			agent.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("compute_stats", {
							quantities: [
								{ name: "SWD", value: cell("SWD", "correctly_denoised"), of: cell("SWD", "test_signals") },
								{ name: "Baseline B", value: cell("Baseline B", "correctly_denoised"), of: cell("Baseline B", "test_signals") },
							],
							compare: [{ a: "SWD", b: "Baseline B" }],
						}),
						fauxToolCall("evidence", {
							action: "add",
							entries: [{ claim: "Windows of 256 samples", class: "author-reported", source: "materials/method-notes.md" }],
						}),
					],
					{ stopReason: "toolUse" },
				),
				call("write", {
					path: "paper/sections/results.tex",
					content:
						"\\section{Results and Discussion}\\label{sec:results}\nSWD met the criterion for 160 of 200 signals (80\\%), Baseline B for 150 (75\\%): 5 percentage points, a relative increase of 6.67\\%. Windows had 256 samples; runtime was 42.5 ms.\n",
				}),
				call("report_changes", { summary: "Drafted the results from the computed statistics" }),
				say("Results drafted."),
			]);
			await agent.session.prompt("Write the results");
			const ledger = loadLedger(join(agent.cwd, "notes", "evidence.json"));
			assert.deepEqual(
				ledger.entries.map((e) => [e.id, e.class]),
				[
					["E1", "verified"],
					["E2", "verified"],
					["E3", "verified"],
					["E4", "author-reported"],
				],
			);
			const reports = gates(agent);
			assert.equal(reports.length, 1);
			assert.match(reports[0] ?? "", /Compiled paper\/main\.tex/);
			// Only the unrecorded runtime is reported; a WARN alone starts no fix round.
			assert.match(reports[0] ?? "", /V01[^\n]*'42\.5' is not in the evidence ledger/);
			assert.doesNotMatch(reports[0] ?? "", /'(?:160|200|80|150|75|6\.67|256)' is not in/);
			assert.match(reports[0] ?? "", /没有阻断性问题/);
			assert.equal(agent.pendingResponses(), 0);
			// The shared ledger shows up in the project state of the next prompt.
			agent.setResponses([say("ok")]);
			await agent.session.prompt("status?");
			const systemText = agent.session.messages
				.filter((m) => m.role === "system")
				.map((m) => getSystemMessageText(m))
				.join("\n");
			assert.match(systemText, /证据账本 notes\/evidence\.json：4 entries/);
		} finally {
			agent.cleanup();
		}
	});

	test("paper_init in a new folder, then the gate catches an undefined citation and starts a fix round", async () => {
		const agent = await createTestAgent();
		try {
			agent.setResponses([call("paper_init", { template: "article", journal: "Synthetic Journal" }), say("Workspace ready.")]);
			await agent.session.prompt("Start a new paper");
			assert.ok(existsSync(join(agent.cwd, "2PI.md")));
			assert.ok(existsSync(join(agent.cwd, "paper", "main.tex")));
			assert.match(readFileSync(join(agent.cwd, "2PI.md"), "utf8"), /- 目标期刊：Synthetic Journal/);

			agent.setResponses([
				call("write", { path: "paper/sections/methods.tex", content: "\\section{Methods}\\label{sec:methods}\nWe follow \\cite{synthetic2020}.\n" }),
				say("Methods drafted."),
				(context) => {
					const last = JSON.stringify(context.messages.at(-1));
					assert.match(last, /Undefined citations: synthetic2020/);
					assert.match(last, /自动修复轮 1\/2/);
					return call("write", {
						path: "paper/sections/methods.tex",
						content: "\\section{Methods}\\label{sec:methods}\nWe follow [MISSING: source supporting this statement].\n",
					});
				},
				say("Replaced the unverified citation with a gap marker."),
			]);
			await agent.session.prompt("Draft the methods");
			assert.equal(agent.pendingResponses(), 0);
			const reports = gates(agent);
			assert.equal(reports.length, 2);
			assert.match(reports[1] ?? "", /Compiled paper\/main\.tex/);
			assert.match(reports[1] ?? "", /0 error\(s\)/);
		} finally {
			agent.cleanup();
		}
	});

	test("pdf_preview renders pages of the compiled manuscript", { skip: renderer ? false : "no PDF renderer" }, async () => {
		const agent = await createTestAgent();
		try {
			initPaperWorkspace(agent.cwd, "article");
			const compiled = await compileProject(new PaperState(), agent.cwd, undefined);
			assert.ok(compiled.result?.ok, compiled.text);
			const result = await pdfPreviewTool.execute("t", { pages: "1-5", width: 600 }, undefined, undefined, toolCtx(agent.cwd));
			const images = result.content.filter((c) => c.type === "image");
			assert.ok(images.length >= 1);
			const first = images[0];
			const png = Buffer.from(first?.type === "image" ? first.data : "", "base64");
			assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
			assert.match(textOf(result), /paper\/build\/main\.pdf: \d+ page\(s\)/);
		} finally {
			agent.cleanup();
		}
	});
});
