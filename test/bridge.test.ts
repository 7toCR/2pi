/** P1b: a patent drafted in a paper project uses the shared evidence ledger. */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { addEntries, emptyLedger, saveLedger } from "../src/core/evidence.ts";
import { GATE_MESSAGE } from "../src/core/gate.ts";
import { salientPatentNumbers, traceAgainstLedger, traced } from "../src/packs/patent/ledger.ts";
import { createTestAgent, customMessages, patentSkillDir, textOf, toolResults } from "./helpers.ts";

test("salientPatentNumbers keeps measured values and skips reference numerals, steps, years, figures and placeholders", () => {
	const text =
		"步骤S101中，将信号划分为256个采样点的窗口，检查修订模块304判断峰值与中位绝对偏差之比是否超过8；" +
		"达标率为80%，比基线高5个百分点，平均耗时42.5毫秒。见图12，权利要求10，2024年公开。" +
		"窗口步长为【待补充：滑窗步长，例如 16 个采样点】。采样率1 kHz。";
	assert.deepEqual(salientPatentNumbers(text), ["256", "80", "42.5"]);
	assert.equal(traced("6.67", [6.6666666667]), true);
	assert.equal(traced("6.7", [6.6666666667]), true);
	assert.equal(traced("6.6", [6.6666666667]), false);
});

test("traceAgainstLedger reads application text only and ignores numbers of missing entries", () => {
	const ledger = emptyLedger();
	addEntries(ledger, [
		{ claim: "SWD met the criterion for 160 of 200 signals (80%)", class: "verified", source: "materials/results.csv" },
		{ claim: "The stride is 16 samples", class: "missing", source: "materials/method-notes.md" },
	]);
	const dir = mkdtempSync(join(tmpdir(), "2pi-ledger-"));
	const file = join(dir, "evidence.json");
	saveLedger(file, ledger);
	const trace = traceAgainstLedger(
		{
			abstract: "达标率为80%。",
			claims: ["1.一种方法，其特征在于，窗口步长为16个采样点。"],
			description: { embodiments: ["耗时42.5毫秒。"] },
			notes: { claim_plan: "99.9% 不在申请文本中" },
		},
		file,
	);
	assert.deepEqual(
		trace?.untraced.map((item) => item.token),
		["16", "42.5"],
	);
	assert.match(trace?.untraced[0]?.where ?? "", /^claims\[1\]/);
	rmSync(dir, { recursive: true, force: true });
});

test("in a paper project, patent_check reports patent numbers missing from the ledger; that alone starts no fix round", async () => {
	const agent = await createTestAgent({ files: { "2PI.md": "- 类型：both\n", "paper/main.tex": "\\documentclass{article}\n" } });
	try {
		const ledger = emptyLedger();
		addEntries(ledger, [{ claim: "Synthetic fact without the example's numbers", class: "verified", source: "materials/notes.md" }]);
		saveLedger(join(agent.cwd, "notes", "evidence.json"), ledger);
		const example = readFileSync(join(patentSkillDir(), "assets", "example_patent_content.json"), "utf8");
		agent.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "patent/patent.json", content: example })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("patent_check", { json_path: "patent/patent.json" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("checked"),
		]);
		await agent.session.prompt("写专利");
		const check = textOf(toolResults(agent.session, "patent_check").at(-1));
		assert.match(check, /账本对账（提示，不阻断）/);
		// Advisory only: no fix round is started for untraced numbers.
		assert.equal(agent.pendingResponses(), 0);
		const system = agent.session.messages
			.filter((m) => m.role === "system")
			.map((m) => JSON.stringify(m))
			.join("\n");
		assert.match(system, /证据账本/);
		assert.equal(customMessages(agent.session, GATE_MESSAGE).length, 0);
	} finally {
		agent.cleanup();
	}
});
