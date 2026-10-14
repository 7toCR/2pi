/**
 * P2 change visualization: the block model, alignment and word diff, reasons from report_changes,
 * the /changes viewer, the HTML review page, the tracked-changes DOCX and the latexdiff PDF, and
 * the gate reminder for an unexplained revision.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { alignBlocks, wordDiff } from "../src/core/blockdiff.ts";
import type { Block } from "../src/core/blocks.ts";
import { changeLines, PLAIN_STYLE, ScrollViewer } from "../src/core/changes-view.ts";
import { resolvePython } from "../src/core/config.ts";
import { tool } from "../src/core/exec.ts";
import { GATE_MESSAGE } from "../src/core/gate.ts";
import { History } from "../src/core/history.ts";
import { makeRedline } from "../src/core/redline.ts";
import { attachReasons, type BlockChange } from "../src/core/review.ts";
import { defaultPacks } from "../src/extension.ts";
import { latexBlocks } from "../src/packs/paper/blocks.ts";
import { initPaperWorkspace } from "../src/packs/paper/config.ts";
import { detectEngine } from "../src/packs/paper/latex.ts";
import { patentBlocks } from "../src/packs/patent/blocks.ts";
import { copyExample, createTestAgent, customMessages, patentSkillDir, textOf, toolResults } from "./helpers.ts";

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const say = (text: string) => fauxAssistantMessage(text);
const example = () => JSON.parse(readFileSync(join(patentSkillDir(), "assets", "example_patent_content.json"), "utf8"));
const blocks = (texts: string[]): Block[] => texts.map((text, i) => ({ id: `b${i + 1}`, title: `块${i + 1}`, text }));
const extractors = () => defaultPacks().flatMap((pack) => (pack.blocks ? [pack.blocks] : []));

function zipPart(path: string, part: string): string {
	const python = resolvePython();
	const script = "import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))";
	return execFileSync(python.command, [...python.args, "-c", script, path, part], { encoding: "utf8" });
}

describe("block model and diff", () => {
	test("a patent JSON splits into blocks in application order; generated fields are left out", () => {
		const data = example();
		data.drawing_assets = [{ figure_no: 1, path: "out/fig1.png" }];
		const list = patentBlocks("patent/patent.json", JSON.stringify(data)) ?? [];
		const ids = list.map((block) => block.id);
		assert.deepEqual(ids.slice(0, 3), ["name", "abstract", "claims/1"]);
		assert.equal(ids.filter((id) => id.startsWith("claims/")).length, data.claims.length);
		assert.ok(ids.includes("description/embodiments/1"));
		assert.ok(ids.includes("drawings/1"));
		assert.ok(!ids.some((id) => id.startsWith("drawing_assets")));
		assert.equal(list.find((block) => block.id === "claims/2")?.title, "权利要求2");
		assert.equal(patentBlocks("notes/evidence.json", JSON.stringify({ entries: [] })), undefined);
		assert.equal(patentBlocks("patent/patent.json", "{ not json"), undefined);
	});

	test("LaTeX paragraphs are titled by the section above them; comment-only paragraphs are skipped", () => {
		const tex = "\\section{Methods}\\label{sec:methods}\nFirst.\n\n% a note\n\nSecond.\n\n\\subsection{SWD-A}\nThird.\n";
		const list = latexBlocks("paper/sections/methods.tex", tex) ?? [];
		assert.deepEqual(
			list.map((block) => block.title),
			["Methods 第1段", "Methods 第2段", "SWD-A 第1段"],
		);
		assert.equal(latexBlocks("notes/memo.md", tex), undefined);
	});

	test("an inserted block marks only itself; a small rewrite is a modification, not remove + add", () => {
		const before = blocks(["一种方法，包括步骤A。", "根据权利要求1所述的方法，其中A为滤波。", "根据权利要求1所述的方法，其中阈值为0.5。"]);
		const after = blocks([
			"一种方法，包括步骤A。",
			"根据权利要求1所述的方法，其中还包括步骤B。",
			"根据权利要求1所述的方法，其中A为滤波。",
			"根据权利要求1所述的方法，其中阈值为0.6。",
		]);
		assert.deepEqual(
			alignBlocks(before, after).map((block) => block.status),
			["unchanged", "added", "unchanged", "modified"],
		);
		const replaced = alignBlocks(blocks(["完全不同的第一段内容"]), blocks(["Entirely new English text"]));
		assert.deepEqual(
			replaced.map((block) => block.status),
			["removed", "added"],
		);
	});

	test("the word diff works character by character for Chinese and keeps unchanged text intact", () => {
		const before = "当最大绝对样本值大于阈值时，判定为脉冲。";
		const after = "当峰值大于阈值时，判定为脉冲。";
		const segments = wordDiff(before, after);
		const join = (ops: string[]) => segments.filter((s) => ops.includes(s.op)).map((s) => s.text).join("");
		assert.equal(join(["=", "-"]), before);
		assert.equal(join(["=", "+"]), after);
		assert.ok(segments.some((s) => s.op === "=" && s.text.includes("大于阈值时，判定为脉冲。")));
		assert.ok(segments.some((s) => s.op === "-" && s.text.includes("最大绝对样本")));
	});

	test("short unchanged stretches between edits are folded, so a rewrite reads as phrases", () => {
		const before = "SWD-A was designed to reduce the influence of short events.";
		const after = "SWD-A aimed to limit the influence of short events.";
		const segments = wordDiff(before, after);
		const join = (ops: string[]) => segments.filter((s) => ops.includes(s.op)).map((s) => s.text).join("");
		assert.equal(join(["=", "-"]), before);
		assert.equal(join(["=", "+"]), after);
		assert.deepEqual(
			segments.map((s) => s.op),
			["=", "-", "+", "="],
		);
		assert.match(segments[1]?.text ?? "", /^was designed to reduce\s?$/);
		assert.equal(segments[0]?.text, "SWD-A ");
	});

	test("a reason naming a file is the default for its blocks; a block's own reason wins", () => {
		const change = (block: string, title: string): BlockChange => ({ file: "patent/patent.json", block, title, op: "modified" });
		const { changes } = attachReasons([change("claims/1", "权利要求1"), change("notes/检查与核对", "撰写说明·检查与核对")], [
			{ target: "patent/patent.json", why: "统一术语" },
			{ target: "撰写说明·检查与核对", why: "记录本轮检查" },
		]);
		assert.deepEqual(
			changes.map((c) => c.why),
			["统一术语", "记录本轮检查"],
		);
	});

	test("a section name is the default for its blocks; it never matches a longer claim number", () => {
		const change = (block: string, title: string): BlockChange => ({ file: "patent/patent.json", block, title, op: "modified" });
		const { changes, unmatched } = attachReasons(
			[
				change("description/embodiments/21", "说明书·具体实施方式 第21段"),
				change("description/embodiments/23", "说明书·具体实施方式 第23段"),
				change("claims/10", "权利要求10"),
			],
			[
				{ target: "说明书·具体实施方式", why: "统一模块名称" },
				{ target: "说明书·具体实施方式 第23段", why: "同时保留步骤对应关系" },
				{ target: "权利要求1", why: "不应落到权利要求10" },
			],
		);
		assert.deepEqual(
			changes.map((c) => c.why),
			["统一模块名称", "同时保留步骤对应关系", undefined],
		);
		assert.deepEqual(
			unmatched.map((r) => r.target),
			["权利要求1"],
		);
	});

	test("generated files are listed, not split into blocks; a reasons-only report keeps the summary", () => {
		const cwd = mkdtempSync(join(tmpdir(), "2pi-blocks-"));
		try {
			writeFileSync(join(cwd, "memo.md"), "# 说明\n\n第一段。\n\n第二段。\n");
			writeFileSync(join(cwd, "fig.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><text>拆窗决策模块</text></svg>\n');
			const history = new History(cwd, extractors());
			history.beginTurn("改名");
			writeFileSync(join(cwd, "memo.md"), "# 说明\n\n第一段。\n\n第二段，已改。\n");
			writeFileSync(join(cwd, "fig.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><text>窗口拆分模块</text></svg>\n');
			history.report("统一模块名称", []);
			history.report(undefined, [{ target: "说明 第3段", why: "补充说明" }]);
			const change = history.endTurn();
			assert.equal(change?.summary, "统一模块名称");
			assert.deepEqual(
				change?.blocks?.map((b) => [b.file, b.title, b.why]),
				[["memo.md", "说明 第3段", "补充说明"]],
			);
			assert.match(changeLines(change!, PLAIN_STYLE).join("\n"), /其他文件（不逐块比较）：fig\.svg/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("reasons attach to the blocks they name; exact names win over shortened ones", () => {
		const change = (block: string, title: string): BlockChange => ({ file: "patent/patent.json", block, title, op: "modified" });
		const changes = [
			change("claims/1", "权利要求1"),
			change("support_map/1", "支持关系·权利要求1"),
			change("description/embodiments/3", "说明书·具体实施方式 第3段"),
		];
		const { changes: result, unmatched } = attachReasons(changes, [
			{ target: "权利要求 1", why: "统一术语" },
			{ target: "具体实施方式 第3段", why: "与权利要求1一致" },
			{ target: "patent.json support_map/1", why: "更新出处" },
			{ target: "权利要求9", why: "不存在" },
		]);
		assert.deepEqual(
			result.map((c) => c.why),
			["统一术语", "更新出处", "与权利要求1一致"],
		);
		assert.deepEqual(
			unmatched.map((r) => r.target),
			["权利要求9"],
		);
	});
});

describe("change views", () => {
	test("report_changes reasons reach the change set, the viewer, the review page and the tracked-changes DOCX", async () => {
		const agent = await createTestAgent({ files: { "2PI.md": "- 类型：patent\n" } });
		try {
			copyExample(agent.cwd, "patent/patent.json");
			const data = example();
			const claim1 = String(data.claims[0]);
			const marker = claim1.slice(10, 16);
			data.claims[0] = claim1.replace(marker, "【改写】");
			const embodiments = data.description.embodiments as unknown[];
			const index = embodiments.findIndex((item) => typeof item === "string" && item.length > 20);
			embodiments[index] = `${String(embodiments[index])}该步骤可并行执行。`;
			agent.setResponses([
				call("write", { path: "patent/patent.json", content: JSON.stringify(data, null, 2) }),
				call("report_changes", {
					summary: "按用户要求改写权利要求1，并补充实施方式",
					reasons: [
						{ target: "权利要求1", why: "用户要求统一术语" },
						{ target: `具体实施方式 第${index + 1}段`, why: "补充并行执行的说明" },
					],
				}),
				say("改好了"),
			]);
			await agent.session.prompt("改一下权利要求1和一段实施方式");
			assert.equal(agent.pendingResponses(), 0);
			const report = textOf(toolResults(agent.session, "report_changes").at(-1));
			assert.match(report, /本轮修改了 2 处/);

			// The change set lists exactly the two changed blocks, each with its reason.
			const history = new History(agent.cwd, extractors());
			const change = history.changes.list().at(-1);
			assert.ok(change);
			assert.equal(change.summary, "按用户要求改写权利要求1，并补充实施方式");
			assert.deepEqual(
				change.blocks?.map((b) => [b.block, b.op, b.why]),
				[
					["claims/1", "modified", "用户要求统一术语"],
					[`description/embodiments/${index + 1}`, "modified", "补充并行执行的说明"],
				],
			);
			// The gate saw the account and did not ask for one.
			assert.ok(!customMessages(agent.session, GATE_MESSAGE).map(textOf).some((text) => text.includes("report_changes")));

			// Viewer: word-level marks and reasons, nothing about unchanged claims.
			const lines = changeLines(change, PLAIN_STYLE).join("\n");
			assert.match(lines, /权利要求1 （修改）/);
			assert.match(lines, /为什么：用户要求统一术语/);
			assert.ok(lines.includes(`[-${marker}-]{+【改写】+}`));
			assert.ok(!lines.includes("权利要求2"));
			let closed = false;
			const viewer = new ScrollViewer(lines.split("\n"), { height: () => 8, onClose: () => (closed = true), requestRender: () => {}, footer: (t) => t });
			const first = viewer.render(60);
			assert.equal(first.length, 7);
			viewer.handleInput("\u001b[6~");
			assert.notDeepEqual(viewer.render(60), first);
			viewer.handleInput("q");
			assert.ok(closed);

			// Review page and DOCX.
			const result = await makeRedline(history, defaultPacks(), undefined);
			assert.equal(result.changedBlocks, 2);
			const page = readFileSync(result.page, "utf8");
			assert.equal((page.match(/<article class="block modified">/g) ?? []).length, 2);
			assert.match(page, /为什么：<\/b>用户要求统一术语/);
			assert.match(page, /<details class="same"><summary>未改动 \d+ 段/);
			const docx = result.outputs.find((output) => output.path?.endsWith(".docx"));
			assert.ok(docx?.path && existsSync(docx.path), JSON.stringify(result.outputs));
			const xml = zipPart(docx.path, "word/document.xml");
			const paragraphs = xml.split("</w:p>");
			const revised = paragraphs.filter((p) => p.includes("<w:ins ") || p.includes("<w:del "));
			assert.equal(revised.length, 2, "only the two changed blocks carry revisions");
			assert.ok(revised[0]?.includes("【改写】"));
			assert.ok(revised[0]?.includes(`<w:delText xml:space="preserve">${marker}</w:delText>`));
			assert.match(zipPart(docx.path, "word/comments.xml"), /用户要求统一术语/);
			assert.match(zipPart(docx.path, "word/settings.xml"), /<w:trackRevisions\/>/);
		} finally {
			agent.cleanup();
		}
	});

	test("a revision without report_changes gets one reminder; a new draft needs none", async () => {
		const agent = await createTestAgent({ files: { "2PI.md": "- 类型：patent\n" } });
		try {
			agent.setResponses([call("write", { path: "patent/patent.json", content: JSON.stringify(example(), null, 2) }), say("初稿完成")]);
			await agent.session.prompt("写初稿");
			assert.equal(agent.pendingResponses(), 0);
			assert.ok(!customMessages(agent.session, GATE_MESSAGE).map(textOf).some((text) => text.includes("report_changes")));

			const data = example();
			data.claims[1] = `${String(data.claims[1]).replace(/。$/, "")}，且步长为1。`;
			agent.setResponses([
				call("write", { path: "patent/patent.json", content: JSON.stringify(data, null, 2) }),
				say("改好了"),
				(context) => {
					const last = JSON.stringify(context.messages.at(-1));
					assert.match(last, /patent\/patent\.json，还没有用 report_changes/);
					return call("report_changes", { summary: "补充步长", reasons: [{ target: "权利要求2", why: "用户要求" }] });
				},
				say("已说明"),
			]);
			await agent.session.prompt("给权利要求2加上步长");
			assert.equal(agent.pendingResponses(), 0);
			const change = new History(agent.cwd, extractors()).changes.list().at(-1);
			assert.deepEqual(
				change?.blocks?.map((b) => [b.title, b.why]),
				[["权利要求2", "用户要求"]],
			);
		} finally {
			agent.cleanup();
		}
	});

	const latexReady = !!tool("LATEXDIFF", "latexdiff") && !!detectEngine();
	test("the paper redline is a latexdiff PDF marking only the changed paragraph", { skip: latexReady ? false : "no latexdiff or LaTeX engine" }, async () => {
		const agent = await createTestAgent();
		try {
			initPaperWorkspace(agent.cwd, "article");
			const methods = join(agent.cwd, "paper", "sections", "methods.tex");
			mkdirSync(join(methods, ".."), { recursive: true });
			writeFileSync(
				methods,
				"\\section{Methods}\\label{sec:methods}\nWe split each recording into windows of fixed length.\n\nEach window is scored by its largest absolute sample value, and windows above the threshold are marked.\n\nMarked windows are then repaired by interpolation.\n",
			);
			agent.setResponses([
				call("edit", {
					path: "paper/sections/methods.tex",
					edits: [{ oldText: "largest absolute sample value", newText: "peak value" }],
				}),
				call("report_changes", { summary: "统一术语", reasons: [{ target: "Methods 第2段", why: "用户要求改称峰值" }] }),
				say("done"),
			]);
			await agent.session.prompt("Use 'peak value' in the methods");
			const history = new History(agent.cwd, extractors());
			const change = history.changes.list().at(-1);
			assert.deepEqual(
				change?.blocks?.map((b) => [b.title, b.why]),
				[["Methods 第2段", "用户要求改称峰值"]],
			);
			const result = await makeRedline(history, defaultPacks(), change?.id);
			const pdf = result.outputs.find((output) => output.path?.endsWith(".pdf"));
			assert.ok(pdf?.path && existsSync(pdf.path), JSON.stringify(result.outputs));
			const tex = readFileSync(join(pdf.path, "..", "paper-redline.tex"), "utf8");
			const marked = tex.split("\n").filter((line) => /\\DIF(add|del)\{/.test(line) && !line.includes("%DIF PREAMBLE"));
			assert.ok(marked.length >= 1);
			assert.ok(marked.every((line) => /largest|absolute|sample|peak/.test(line)), marked.join("\n"));
			assert.ok(!marked.some((line) => /interpolation|fixed length/.test(line)));
		} finally {
			agent.cleanup();
		}
	});
});
