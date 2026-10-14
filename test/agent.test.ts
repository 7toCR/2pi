import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage, getSystemMessageText } from "@earendil-works/pi-ai";
import { AGENT_ROOT } from "../src/core/config.ts";
import { GATE_MESSAGE } from "../src/core/gate.ts";
import {
	copyExample,
	createTestAgent,
	customMessages,
	patentSkillDir,
	type TestAgent,
	textOf,
	toolResults,
	writeTextPdf,
} from "./helpers.ts";

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const say = (text: string) => fauxAssistantMessage(text);

describe("2pi agent in a patent project", () => {
	let agent: TestAgent;
	before(async () => {
		agent = await createTestAgent({ files: { "2PI.md": "# 2pi 项目卡\n\n- 类型：patent\n" } });
	});
	after(() => agent.cleanup());

	test("replaces pi's coding prompt with the layered 2pi prompt", async () => {
		agent.setResponses([say("好的")]);
		await agent.session.prompt("你好");
		// The prompt the model received is the transcript's system message, built after before_agent_start.
		const head = getCurrentSystemMessage(agent.session.messages);
		assert.ok(head);
		const prompt = getSystemMessageText(head);
		assert.match(prompt, /你是 2pi/);
		assert.doesNotMatch(prompt, /expert coding assistant/);
		const sections = Object.keys(head.sections ?? {});
		for (const name of ["tools", "workspace", "domains", "skill_patent", "guide_patent", "project_state"]) {
			assert.ok(sections.includes(name), `missing section ${name}`);
		}
		// The paper pack is installed but not used by this project: listed, not inlined.
		assert.ok(!sections.includes("skill_paper"));
		assert.match(prompt, /- paper：研究材料 → 可逐句核对的 SCI 论文初稿.*skill：/);
		// The per-turn state comes last so the static prefix stays cacheable.
		assert.equal(sections.at(-1), "project_state");
		// Skill-relative paths point into the knowledge base, so the model can read them directly.
		const skillDir = patentSkillDir();
		assert.ok(prompt.includes(`${skillDir}/references/patentability-and-disclosure.md`));
		assert.ok(prompt.includes(`${skillDir}/assets/example_patent_content.json`));
		assert.match(prompt, /paper_ingest：解析论文/);
	});

	test("registers core, paper and patent tools next to pi's built-ins", () => {
		const tools = agent.session.getActiveToolNames();
		for (const name of [
			"read",
			"write",
			"edit",
			"bash",
			"paper_ingest",
			"update_plan",
			"ask_user",
			"evidence",
			"compute_stats",
			"pdf_preview",
			"patent_check",
			"patent_build",
			"check_draft",
			"latex_compile",
			"paper_init",
			"fill_gaps",
			"bib_lookup",
		]) {
			assert.ok(tools.includes(name), `missing tool ${name}`);
		}
	});

	test("patent_check reports the example draft as clean", async () => {
		copyExample(agent.cwd);
		agent.setResponses([call("patent_check", { json_path: "patent/patent.json" }), say("检查完成")]);
		await agent.session.prompt("检查 patent.json");
		const result = toolResults(agent.session, "patent_check").at(-1);
		assert.ok(result && !result.isError, textOf(result));
		assert.match(textOf(result), /检查结果：0 个错误/);
	});

	test("guard blocks writes outside the workspace, into the knowledge base, materials/ and .2pi/", async () => {
		const skillFile = join(patentSkillDir(), "SKILL.md");
		const skillBefore = readFileSync(skillFile, "utf8");
		// Outside both the workspace and the OS temp directory (temp files are allowed).
		const outside = join(AGENT_ROOT, "..", "2pi-guard-test.txt");
		agent.setResponses([
			call("write", { path: outside, content: "x" }),
			call("write", { path: skillFile, content: "overwritten" }),
			call("write", { path: "materials/notes.md", content: "x" }),
			call("write", { path: ".2pi/changes/c9999.json", content: "{}" }),
			call("bash", { command: "git push origin main" }),
			call("write", { path: ".2pi/scratch/extracted.txt", content: "临时文件" }),
			say("已停止"),
		]);
		await agent.session.prompt("试试越界写入");
		// The scratch area is the one writable place inside .2pi/.
		assert.ok(!toolResults(agent.session, "write").at(-1)?.isError);
		assert.ok(existsSync(join(agent.cwd, ".2pi", "scratch", "extracted.txt")));
		const writes = toolResults(agent.session, "write").slice(-5, -1);
		assert.ok(writes.every((result) => result.isError));
		assert.match(textOf(writes[0]), /工作目录之外/);
		assert.match(textOf(writes[1]), /只读/);
		assert.match(textOf(writes[2]), /materials/);
		assert.match(textOf(writes[3]), /agent 状态目录/);
		assert.equal(readFileSync(skillFile, "utf8"), skillBefore);
		assert.ok(!existsSync(outside));
		assert.match(textOf(toolResults(agent.session, "bash").at(-1)), /git/);
	});

	test("the gate checks a written patent JSON itself; a clean draft ends the turn", async () => {
		const draft = readFileSync(join(patentSkillDir(), "assets", "example_patent_content.json"), "utf8");
		const before = customMessages(agent.session, GATE_MESSAGE).length;
		agent.setResponses([call("write", { path: "patent/draft.patent.json", content: draft }), say("草稿已写好")]);
		await agent.session.prompt("写一份草稿");
		assert.equal(agent.pendingResponses(), 0);
		const reports = customMessages(agent.session, GATE_MESSAGE).slice(before);
		assert.equal(reports.length, 1);
		assert.match(textOf(reports[0]), /专利：本轮修改后的自动检查/);
		assert.match(textOf(reports[0]), /检查结果：0 个错误/);
		assert.match(textOf(reports[0]), /没有阻断性问题/);
	});

	test("update_plan allows at most one step in progress", async () => {
		agent.setResponses([
			call("update_plan", {
				plan: [
					{ step: "读论文", status: "in_progress" },
					{ step: "写权利要求", status: "in_progress" },
				],
			}),
			call("update_plan", {
				explanation: "开始",
				plan: [
					{ step: "读论文", status: "completed" },
					{ step: "写权利要求", status: "in_progress" },
				],
			}),
			say("计划好了"),
		]);
		await agent.session.prompt("做个计划");
		const [invalid, valid] = toolResults(agent.session, "update_plan").slice(-2);
		assert.ok(invalid?.isError);
		assert.ok(valid && !valid.isError);
		assert.match(textOf(valid), /1\/2 完成/);
	});

	test("paper_ingest writes paged text into .2pi/sources and makes the paper read-only", async () => {
		writeTextPdf(join(agent.cwd, "paper.pdf"), [
			["Multi-Scale Attention Network", "arXiv:2401.01234v2 [cs.CV]", "Abstract"],
			["3 Method", "Figure 2: Overview of the proposed pipeline.", "Table 1: Ablation results."],
		]);
		agent.setResponses([call("paper_ingest", { path: "paper.pdf" }), say("读完了")]);
		await agent.session.prompt("解析论文");
		const result = toolResults(agent.session, "paper_ingest").at(-1);
		assert.ok(result && !result.isError, textOf(result));
		const text = textOf(result);
		assert.match(text, /2 页/);
		assert.match(text, /Figure 2: Overview/);
		assert.match(text, /arXiv:2401\.01234v2/);
		const paper = readFileSync(join(agent.cwd, ".2pi", "sources", "paper", "paper.md"), "utf8");
		assert.match(paper, /\[\[page 2\]\]/);
		agent.setResponses([call("write", { path: "paper.pdf", content: "x" }), say("好")]);
		await agent.session.prompt("改论文");
		assert.ok(toolResults(agent.session, "write").at(-1)?.isError);
	});

	test("patent_build produces the deliverables and the gate asks to look at the drawings", async () => {
		const json = copyExample(agent.cwd, "patent/build.patent.json");
		const before = customMessages(agent.session, GATE_MESSAGE).length;
		agent.setResponses([call("patent_build", { json_path: "patent/build.patent.json" }), say("已生成"), say("稍后再看")]);
		await agent.session.prompt("生成文件");
		const result = toolResults(agent.session, "patent_build").at(-1);
		assert.ok(result && !result.isError, textOf(result));
		const details = result.details as { docxPath: string; pdfPath: string; drawings: string[]; previews: string[] };
		assert.ok(existsSync(details.docxPath));
		assert.ok(existsSync(details.pdfPath));
		assert.ok(details.drawings.length >= 1 && details.drawings.every((path) => existsSync(path)));
		assert.ok(details.previews.length >= 1);
		assert.ok(JSON.parse(readFileSync(json, "utf8")).drawing_assets.length >= 1);
		const reminders = customMessages(agent.session, GATE_MESSAGE).slice(before);
		assert.equal(reminders.length, 1);
		assert.match(textOf(reminders[0]), /附图没有查看/);
		// The same reminder is not repeated: the model may stop after explaining itself.
		assert.equal(agent.pendingResponses(), 0);
	});

	test("drawings read and the PDF seen through pdf_preview satisfy the gate", async () => {
		copyExample(agent.cwd, "patent/seen.patent.json");
		const before = customMessages(agent.session, GATE_MESSAGE).length;
		let details: { pdfPath: string; drawings: string[] } | undefined;
		agent.setResponses([
			call("patent_build", { json_path: "patent/seen.patent.json" }),
			(context) => {
				const result = [...context.messages].reverse().find((m) => m.role === "toolResult");
				details = (result as { details?: typeof details } | undefined)?.details;
				return fauxAssistantMessage(
					[
						...(details?.drawings ?? []).map((path) => fauxToolCall("read", { path })),
						fauxToolCall("pdf_preview", { pdf: details?.pdfPath ?? "", pages: "1-2", width: 400 }),
					],
					{ stopReason: "toolUse" },
				);
			},
			say("都看过了"),
		]);
		await agent.session.prompt("生成并查看");
		assert.ok(details && details.drawings.length > 0);
		assert.ok(!toolResults(agent.session, "pdf_preview").at(-1)?.isError);
		assert.equal(customMessages(agent.session, GATE_MESSAGE).length, before, "nothing left to remind");
		assert.equal(agent.pendingResponses(), 0);
	});

	test("patent_build refuses a draft with errors unless forced", async () => {
		const json = copyExample(agent.cwd, "patent/broken.patent.json");
		const data = JSON.parse(readFileSync(json, "utf8"));
		data.claims[0] = `${data.claims[0]}。还有一句`;
		writeFileSync(json, JSON.stringify(data, null, 2));
		// The remaining ERRORs keep the gate asking for fixes, at most two rounds.
		agent.setResponses([
			call("patent_build", { json_path: "patent/broken.patent.json" }),
			say("先修错误"),
			say("等你确认"),
			say("仍未修复"),
		]);
		await agent.session.prompt("构建");
		const result = toolResults(agent.session, "patent_build").at(-1);
		assert.ok(result?.isError);
		assert.match(textOf(result), /未构建/);
		assert.equal(agent.pendingResponses(), 0);
		assert.match(textOf(customMessages(agent.session, GATE_MESSAGE).at(-1)), /仍有 2 个 ERROR[\s\S]*已用完/);
	});
});

describe("end-of-turn gate", () => {
	test("in print mode a report that starts no fix round is not appended after the answer", async () => {
		const agent = await createTestAgent({ files: { "2PI.md": "- 类型：patent\n" }, mode: "print" });
		try {
			const draft = readFileSync(join(patentSkillDir(), "assets", "example_patent_content.json"), "utf8");
			agent.setResponses([call("write", { path: "patent/draft.patent.json", content: draft }), say("草稿已写好")]);
			await agent.session.prompt("写一份草稿");
			// pi's print mode outputs the last message only when it is the model's answer.
			const last = agent.session.messages.at(-1);
			assert.equal(last?.role, "assistant");
			assert.equal(textOf(last), "草稿已写好");
			assert.equal(customMessages(agent.session, GATE_MESSAGE).length, 0);
		} finally {
			agent.cleanup();
		}
	});

	test("an ERROR in a written patent JSON starts a fix round; rounds are capped at two per prompt", async () => {
		const agent = await createTestAgent({ files: { "2PI.md": "- 类型：patent\n" } });
		try {
			const data = JSON.parse(readFileSync(join(patentSkillDir(), "assets", "example_patent_content.json"), "utf8"));
			data.claims[0] = `${data.claims[0]}。还有一句`;
			agent.setResponses([
				call("write", { path: "patent/bad.patent.json", content: JSON.stringify(data, null, 2) }),
				say("v1"),
				say("v2"),
				say("v3"),
				say("must not be requested"),
			]);
			await agent.session.prompt("写一份有错的草稿");
			assert.equal(agent.pendingResponses(), 1, "the gate stops after two fix rounds");
			const reports = customMessages(agent.session, GATE_MESSAGE).map(textOf);
			assert.equal(reports.length, 3);
			assert.match(reports[0] ?? "", /自动修复轮 1\/2/);
			assert.match(reports[2] ?? "", /已用完/);

			// A new prompt resets the budget; fixing the draft ends the turn.
			agent.setResponses([
				call("write", { path: "patent/bad.patent.json", content: readFileSync(join(patentSkillDir(), "assets", "example_patent_content.json"), "utf8") }),
				call("report_changes", { summary: "修正权利要求1", reasons: [{ target: "权利要求1", why: "一项权利要求只能有一个句号" }] }),
				say("修好了"),
			]);
			await agent.session.prompt("修一下");
			assert.equal(agent.pendingResponses(), 0);
			assert.match(textOf(customMessages(agent.session, GATE_MESSAGE).at(-1)), /没有阻断性问题/);
		} finally {
			agent.cleanup();
		}
	});
});

describe("project context", () => {
	test("keeps the project's own context files and 2PI.md, drops instructions from parent directories", async () => {
		const agent = await createTestAgent({
			contextFiles: true,
			files: {
				"../CLAUDE.md": "仓库级说明 PARENT_RULE",
				"AGENTS.md": "项目内说明 PROJECT_RULE",
				"2PI.md": "# 2pi 项目卡\n\n- 类型：patent\n- 联网检索：允许\n",
			},
		});
		try {
			agent.setResponses([say("好")]);
			await agent.session.prompt("你好");
			const head = getCurrentSystemMessage(agent.session.messages);
			assert.ok(head);
			const prompt = getSystemMessageText(head);
			assert.match(prompt, /PROJECT_RULE/);
			assert.match(prompt, /类型：patent/);
			assert.doesNotMatch(prompt, /PARENT_RULE/);
			assert.match(prompt, /项目卡 2PI\.md（类型 patent）/);
			assert.match(prompt, /联网检索：项目卡允许/);
		} finally {
			agent.cleanup();
		}
	});
});
