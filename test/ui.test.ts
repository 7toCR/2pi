/** 2pi's terminal look: compact tool rows, the one-line check report, first-run display defaults. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { createReadToolDefinition, initTheme, type Theme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { applyUiDefaults, retryBudget } from "../src/ui/defaults.ts";
import { gateHeadline } from "../src/ui/gate-message.ts";
import { compactRenderers } from "../src/ui/tool-rows.ts";

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function row(tool: string, args: Record<string, unknown>, result: { content: { type: string; text?: string }[]; details?: unknown }, isError = false) {
	const renderers = compactRenderers(tool, undefined);
	const context = {
		args,
		toolCallId: "t1",
		invalidate() {},
		lastComponent: undefined,
		state: {},
		cwd: "D:/work/demo",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError,
		durationMs: 4100,
		outputPad: 1,
	};
	// pi draws the call, then the result, then renders both; the row reads the summary lazily.
	const call = renderers.renderCall?.(args, plainTheme, context as never);
	const below = renderers.renderResult?.(result as never, { expanded: false, isPartial: false }, plainTheme, context as never);
	return [...(call?.render(100) ?? []), ...(below?.render(100) ?? [])];
}

describe("compact tool rows", () => {
	test("a call is one line: mark, verb, target, outcome, duration", () => {
		const text = Array.from({ length: 42 }, (_, i) => `line ${i}`).join("\n");
		assert.deepEqual(row("read", { path: "D:/work/demo/paper/sections/methods.tex" }, { content: [{ type: "text", text }] }), [
			" ✓ 读取     paper/sections/methods.tex  42 行 · 4.1s",
		]);
		const search = row("lit_search", { query: "adaptive window", source: "openalex" }, { content: [{ type: "text", text: "共 759 条，显示 10 条（已加入调研库）。" }] });
		assert.match(search[0] ?? "", /✓ 文献检索 OpenAlex {2}adaptive window {2}10 条（共 759）/);
		const check = row("patent_check", { json_path: "patent/patent.json" }, { content: [{ type: "text", text: "检查结果：0 个错误，4 个警告" }] });
		assert.match(check[0] ?? "", /专利检查 patent\/patent\.json {2}0 错误 · 4 警告/);
	});

	test("a failed command shows its exit code and the lines that say what went wrong", () => {
		const lines = row(
			"bash",
			{ command: "latexmk -pdf main.tex\nsecond line" },
			{ content: [{ type: "text", text: "This is pdfTeX, Version 3.14\n! Undefined control sequence.\nl.42 \\peakratio\n\nCommand exited with code 12" }] },
			true,
		);
		assert.match(lines[0] ?? "", /^ ✗ 命令 +latexmk -pdf main\.tex {2}退出码 12 · 4\.1s$/);
		assert.deepEqual(lines.slice(1).map((line) => line.trim()), ["! Undefined control sequence."]);
		const listing = "ls: cannot access 'missing_dir': No such file or directory\n.:\n2PI.md\nnotes\n\nCommand exited with code 2";
		const ls = row("bash", { command: "ls missing_dir ." }, { content: [{ type: "text", text: listing }] }, true);
		assert.deepEqual(ls.slice(1).map((line) => line.trim()), ["ls: cannot access 'missing_dir': No such file or directory"]);
	});

	test("in pi's own tool row the compact renderer replaces the coloured box", () => {
		initTheme("dark");
		const definition = createReadToolDefinition("D:/work/demo");
		const component = new ToolExecutionComponent(
			"read",
			"t1",
			{ path: "notes/memo.md" },
			{ showImages: false },
			{ ...definition, ...compactRenderers("read", definition as never) } as never,
			{ requestRender() {} } as never,
			"D:/work/demo",
		);
		component.markExecutionStarted();
		component.setArgsComplete();
		component.updateResult({ content: [{ type: "text", text: "a\nb\nc" }], isError: false } as never, false);
		const lines = component.render(80).map(stripTerminalSequences);
		assert.deepEqual(
			lines.filter((line) => line.trim()),
			[" ✓ 读取     notes/memo.md  3 行"],
		);
	});
});

test("the check report becomes a headline with counts and the fix-round status", () => {
	const text = [
		"[交付前检查]",
		"论文：本轮修改后的自动编译与检查\nSummary: 0 error(s), 2 warning(s), 3 info.",
		"专利：本轮修改后的自动检查\n检查结果：1 个错误，4 个警告",
		"引用核验：以下编号……\n- notes/memo.md:51 arXiv:2311.11255\n- notes/memo.md:52 arXiv:2502.05139\n处理：……",
		"还需要你亲自完成：\n- 还有 2 张附图没有查看",
		"自动修复轮 1/2：处理上面的问题后再结束本轮。",
	].join("\n\n");
	assert.deepEqual(gateHeadline(text), {
		parts: ["论文 0 错误 2 警告", "专利 1 错误 4 警告", "引用待核实 2 处", "待办 1 项"],
		status: "自动修复 1/2",
		blocking: true,
	});
	assert.equal(gateHeadline("[交付前检查]\n\n没有阻断性问题。").status, "无阻断问题");
});

test("display defaults are written once and never override the user's own settings", () => {
	const dir = mkdtempSync(join(tmpdir(), "2pi-ui-"));
	try {
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultModel: "m", hideThinkingBlock: false }));
		assert.deepEqual(applyUiDefaults(dir), ["quietStartup", "showImages", "retry"]);
		const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
		assert.equal(settings.defaultModel, "m");
		assert.equal(settings.hideThinkingBlock, false);
		assert.equal(settings.quietStartup, "header");
		assert.equal(settings.showImages, false);
		assert.equal(retryBudget(dir), 5);
		// The user later turns images back on: a second start keeps that.
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ ...settings, showImages: true }));
		assert.deepEqual(applyUiDefaults(dir), []);
		assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).showImages, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an install from before the retry default gets only that, and a user's own retry settings are kept", () => {
	const dir = mkdtempSync(join(tmpdir(), "2pi-ui-"));
	try {
		// Version 1 wrote the display defaults; the user has since turned images back on.
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ quietStartup: "header", showImages: true, twopiUiDefaults: 1 }));
		assert.deepEqual(applyUiDefaults(dir), ["retry"]);
		const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
		assert.equal(settings.showImages, true);
		assert.equal(settings.hideThinkingBlock, undefined, "a version-1 default the user removed is not brought back");
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ retry: { maxRetries: 2 } }));
		assert.deepEqual(applyUiDefaults(dir), ["quietStartup", "hideThinkingBlock", "showImages"]);
		assert.equal(retryBudget(dir), 2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
