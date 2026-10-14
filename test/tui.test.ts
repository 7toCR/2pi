/** The split view, the flow panel and the startup header. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	ScrollView,
	stripTerminalSequences,
	type TUI,
	type TuiMouseEvent,
	Text,
	truncateToWidth,
	VStack,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { getLayoutBoxesAt, renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { bannerLines, LOGO_COLUMNS } from "../src/ui/banner.ts";
import { logoLighting, logoLines, logoRows, renderLogo } from "../src/ui/logo.ts";
import { FlowModel, nodeForTool, USER } from "../src/ui/flow.ts";
import { modelLine, shortDirectory } from "../src/ui/index.ts";
import { clampRatio, readPrefs, SplitView, writePrefs } from "../src/ui/split.ts";

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	getColorMode: () => undefined,
} as unknown as Theme;

const plain = (lines: string[]) => lines.map(stripTerminalSequences);
/** Let every hand-off ball arrive, so the node glyphs are not covered. */
const settle = (flow: FlowModel) => {
	for (let i = 0; i < 80; i++) flow.advance();
};

function clockedFlow(): { flow: FlowModel; advance(ms: number): void } {
	let now = 1_700_000_000_000;
	const flow = new FlowModel();
	flow.now = () => now;
	return { flow, advance: (ms) => (now += ms) };
}

describe("flow panel", () => {
	const tool = (flow: FlowModel, advance: (ms: number) => void, id: string, name: string, args: Record<string, unknown>, text: string, isError = false) => {
		flow.toolStart(id, name, args, "D:/w");
		advance(1000);
		flow.toolEnd(id, { content: [{ type: "text", text }] }, isError, 1000);
	};

	test("tool calls light the step they belong to", () => {
		assert.equal(nodeForTool("paper_ingest", { path: "materials/a.pdf" }), "ingest");
		assert.equal(nodeForTool("read", { path: "materials/notes.md" }), undefined, "reading materials while writing is not a new ingest");
		assert.equal(nodeForTool("read", { path: "patent/build/fig1.png" }), "review");
		assert.equal(nodeForTool("read", { path: "src/main.py" }), undefined);
		assert.equal(nodeForTool("write", { path: "patent/patent.json" }), "patent_draft");
		assert.equal(nodeForTool("edit", { path: "paper\\sections\\methods.tex" }), "paper_draft");
		assert.equal(nodeForTool("bash", { command: "cd paper && latexmk -pdf main.tex" }), "paper_build");
		assert.equal(nodeForTool("bash", { command: "ls" }), undefined);
		assert.equal(nodeForTool("lit_search", { query: "x" }), "research");
		assert.equal(nodeForTool("report_changes", {}), "report");
	});

	test("the track is the domain's usual steps; travelled solid, ahead dotted, no rules between groups", () => {
		const { flow, advance } = clockedFlow();
		flow.setDomains(["patent"]);
		flow.startRun("把 paper.pdf 写成专利");
		tool(flow, advance, "1", "paper_ingest", { path: "materials/paper.pdf" }, "已解析 12 页");
		flow.toolStart("2", "write", { path: "patent/patent.json", content: "{}" }, "D:/w");
		settle(flow);
		const lines = plain(flow.render(48, 0, plainTheme));
		const track = lines.slice(lines.findIndex((line) => line.includes("◆ 你")));
		const labels = track.filter((line) => /^\s*\S \S/.test(line)).map((line) => line.trim().split(/\s+/)[1]);
		assert.deepEqual(labels.slice(0, 9), ["你", "解析材料", "撰写专利", "形式检查", "生成文件", "核对渲染", "交付前检查", "完成"].slice(0, 9));
		assert.ok(track.some((line) => /● 解析材料 +已解析 12 页/.test(line)));
		assert.ok(track.some((line) => /撰写专利 +patent\/patent\.json…/.test(line)));
		// Solid down to the step in progress, dotted after it.
		const at = (label: string) => track.findIndex((line) => line.includes(label));
		assert.equal(track[at("解析材料") + 1]?.trim(), "│");
		assert.equal(track[at("撰写专利") + 1]?.trim(), "┊");
		assert.ok(!lines.some((line) => /[─╭╮╰╯]/.test(line)), "no boxes or rules");
		assert.ok(lines[0]?.includes("写入 patent/patent.json…"), "the header says what the agent does");
		for (const line of flow.render(30, 3, plainTheme)) assert.ok(visibleWidth(line) <= 30, line);
	});

	test("going back to an earlier step draws a loop, and the pass starts again from there", () => {
		const { flow, advance } = clockedFlow();
		flow.setDomains(["patent"]);
		flow.startRun("写专利");
		tool(flow, advance, "1", "write", { path: "patent/patent.json", content: "{}" }, "ok");
		tool(flow, advance, "2", "patent_check", { json_path: "patent/patent.json" }, "检查结果：2 个错误，1 个警告", true);
		flow.toolStart("3", "edit", { path: "patent/patent.json" }, "D:/w");
		settle(flow);
		let lines = plain(flow.render(48, 0, plainTheme));
		const draft = lines.findIndex((line) => line.includes("撰写专利"));
		const check = lines.findIndex((line) => line.includes("形式检查"));
		assert.match(lines[draft] ?? "", /^╭─▸\S 撰写专利 ×2/);
		assert.match(lines[draft + 1] ?? "", /^│ +┊/, "the step being redone is where the solid line ends");
		assert.match(lines[check] ?? "", /^╰──✗ 形式检查 +2 错误 · 1 警告/, "the earlier pass stays in view");
		assert.match(lines[1] ?? "", /回环 1/);

		// A second way back nests outside the first.
		advance(500);
		flow.toolEnd("3", { content: [{ type: "text", text: "ok" }] }, false, 500);
		tool(flow, advance, "4", "patent_check", { json_path: "patent/patent.json" }, "检查结果：0 个错误，0 个警告");
		tool(flow, advance, "5", "patent_build", { json_path: "patent/patent.json" }, "ok");
		flow.gate({ headline: "待办 1 项", blocking: true, fixing: true });
		tool(flow, advance, "6", "lit_search", { query: "prior art" }, "共 9 条，显示 9 条");
		settle(flow);
		lines = plain(flow.render(48, 0, plainTheme));
		const research = lines.findIndex((line) => line.includes("调研检索"));
		const gate = lines.findIndex((line) => line.includes("交付前检查"));
		assert.match(lines[research] ?? "", /^╭───▸● 调研检索/);
		assert.match(lines[gate] ?? "", /^╰────✗ 交付前检查/);
		assert.match(lines[draft + 2] ?? "", /^│ ╭─▸/, "the inner loop keeps its lane");
		assert.match(lines[1] ?? "", /回环 2/);
		assert.match(flow.detail("done", plainTheme).lines.join("\n"), /本轮轨迹：你 → 撰写专利 → 形式检查 → 撰写专利 → 形式检查 → 生成文件 → 交付前检查 → 调研检索/);
	});

	test("clicks map back to steps, and a step keeps its history for the detail view", () => {
		const { flow, advance } = clockedFlow();
		flow.startRun("请求");
		flow.toolStart("1", "lit_search", { query: "adaptive filter", source: "openalex" }, "D:/w");
		advance(1200);
		flow.toolEnd("1", { content: [{ type: "text", text: "共 759 条，显示 10 条" }] }, false, 1200);
		settle(flow);
		const lines = plain(flow.render(40, 0, plainTheme));
		assert.equal(flow.keyAt(lines.findIndex((line) => line.includes("调研检索"))), "research");
		assert.equal(flow.keyAt(lines.findIndex((line) => line.includes("◆ 你"))), USER);
		const detail = flow.detail("research", plainTheme);
		assert.equal(detail.title, "调研检索");
		assert.match(detail.lines.join("\n"), /✓ 文献检索 OpenAlex {2}adaptive filter {2}10 条（共 759） · 1\.2s/);
	});

	test("a dropped connection shows in the header until it is back; the end says how the run ended", () => {
		const { flow } = clockedFlow();
		flow.startRun("请求");
		flow.setNetwork({ phase: "offline", attempt: 2, nextAt: flow.now() + 10_000 });
		let lines = plain(flow.render(48, 0, plainTheme));
		assert.ok(lines.some((line) => line.includes("! 连接中断 · 10s 后探测网络（第 2 次）")));
		flow.setNetwork(undefined);
		assert.ok(!plain(flow.render(48, 0, plainTheme)).some((line) => line.includes("连接中断")));
		flow.settled("error", "fetch failed");
		settle(flow);
		lines = plain(flow.render(48, 0, plainTheme));
		assert.ok(lines.some((line) => /✗ 完成 +fetch failed/.test(line)));
		assert.ok(lines[0]?.includes("出错"));
	});

	test("a new run fades the last one; a dot runs along each hand-off and stops", () => {
		const { flow, advance } = clockedFlow();
		flow.setDomains(["paper"]);
		flow.startRun("第一轮");
		tool(flow, advance, "1", "check_draft", { path: "paper/main.tex" }, "Summary: 0 error(s), 1 warning(s)");
		flow.settled("completed");
		flow.startRun("第二轮");
		flow.toolStart("2", "evidence", { action: "add", entries: [{}] }, "D:/w");
		assert.ok(flow.lively);
		flow.advance();
		assert.ok(plain(flow.render(40, 0, plainTheme)).some((line) => line.includes("•")));
		settle(flow);
		const lines = plain(flow.render(40, 0, plainTheme));
		assert.ok(!lines.some((line) => line.includes("•")));
		assert.ok(lines.some((line) => /● 论文检查 +0 错误 · 1 警告/.test(line)), "the earlier run's result is still shown");
		assert.ok(lines.some((line) => /◆ 你 +第二轮/.test(line)));
	});
});

describe("startup header", () => {
	const info = { version: "0.3.0", model: "superaihub/gpt-6.1-sol · xhigh", directory: "~/papers/demo", domains: "patent", hints: "/init 建立项目" };
	const style = { mode: undefined, appearance: "dark" as const, bold: (t: string) => t, dim: (t: string) => t };
	const brightness = (rgb: [number, number, number]) => rgb[0] + rgb[1] + rgb[2];

	test("the mark: an open book in fine lines, with 2π written across both pages in one lit stroke", () => {
		const columns = 34;
		const rows = logoRows(columns);
		const cells = renderLogo(columns, rows, logoLighting("dark"));
		assert.equal(cells.length, rows);
		for (const line of logoLines(cells, undefined)) assert.equal(visibleWidth(line), columns);
		const lit = cells.map((line) => line.map((cell) => (cell.dots ? brightness(cell.rgb) : 0)));
		const bright = Math.max(...lit.flat()) * 0.7;
		const spine = Math.floor(columns / 2);
		const strokeIn = (from: number, to: number, rowsFrom = 0, rowsTo = rows) =>
			lit.slice(rowsFrom, rowsTo).reduce((sum, line) => sum + line.slice(from, to).filter((value) => value >= bright).length, 0);
		// The "2" fills the left page and the "π" the right one…
		assert.ok(strokeIn(2, spine - 2) > 25, "the 2 on the left page");
		assert.ok(strokeIn(spine + 2, columns - 2) > 25, "the π on the right page");
		// …and the stroke runs on over the gutter, low on the page, without lifting the pen.
		assert.ok(strokeIn(spine - 1, spine + 1, Math.floor(rows / 2), rows) > 0, "one stroke across the spine");
		assert.equal(strokeIn(spine - 1, spine + 1, 0, Math.floor(rows / 3)), 0, "only the base crosses, not the tops");
		// The book itself is drawn in dimmer lines: the top row is outline only.
		assert.ok(lit[0]!.some(Boolean) && lit[0]!.every((value) => value < bright));
	});

	test("the book opens from its spine; light terminals get one tone, like codex", () => {
		const span = (cells: ReturnType<typeof renderLogo>) => {
			const used = cells.flatMap((line) => line.map((cell, column) => (cell.dots ? column : -1)).filter((column) => column >= 0));
			return Math.max(...used) - Math.min(...used);
		};
		const closed = renderLogo(34, logoRows(34), logoLighting("dark"), 0.1);
		const open = renderLogo(34, logoRows(34), logoLighting("dark"), 1);
		assert.ok(span(closed) < span(open) / 2, "nearly closed, the pages stand on the spine");
		const light = renderLogo(34, logoRows(34), logoLighting("light", [36, 41, 47]))
			.flat()
			.filter((cell) => cell.dots);
		assert.ok(light.every(({ rgb: [r, , b] }) => b - r < 20), "no cyan rim or blue shadows on a light background");
		assert.ok(light.every((cell) => brightness(cell.rgb) < 600));
	});

	test("the name, the model and the directory sit beside the mark, under it when narrow, alone when narrower", () => {
		const wide = bannerLines(90, info, style);
		const name = wide.findIndex((line) => line.includes("2pi v0.3.0"));
		assert.ok(name > 1);
		assert.match(wide[name] ?? "", /^ [⠀-⣿ ]+ {2,}2pi v0\.3\.0$/);
		assert.match(wide[name + 1] ?? "", /superaihub\/gpt-6\.1-sol · xhigh$/);
		assert.match(wide[name + 2] ?? "", /~\/papers\/demo · 领域 patent$/);
		assert.equal(wide.at(-1), " /init 建立项目");
		const middle = bannerLines(50, info, style);
		assert.ok(middle.findIndex((line) => line.includes("2pi v0.3.0")) > logoRows(LOGO_COLUMNS));
		assert.deepEqual(plain(bannerLines(30, info, style).slice(0, 4)), ["", " 2pi v0.3.0", " superaihub/gpt-6.1-sol · xhi…", " ~/papers/demo · 领域 patent"]);
		for (const width of [90, 50, 30]) for (const line of bannerLines(width, info, { ...style, mode: "truecolor" })) assert.ok(visibleWidth(line) <= width);
	});

	test("model line and directory", () => {
		assert.equal(modelLine({ provider: "superaihub", id: "gpt-6.1-sol" }, "xhigh"), "superaihub/gpt-6.1-sol · xhigh");
		assert.equal(modelLine({ provider: "anthropic", id: "claude-x" }, "off"), "anthropic/claude-x");
		assert.match(modelLine(undefined, undefined), /\/login/);
		assert.equal(shortDirectory(join(homedir(), "papers", "demo")), "~/papers/demo");
	});
});

describe("split view", () => {
	function piLayout() {
		const transcript = new ScrollView(new Text("transcript line", 0, 0), { follow: "end", primary: true });
		const dock = new VStack([new Text("editor here", 0, 0)]);
		const root = new VStack([
			{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
		]);
		const tui = {
			mode: "fullscreen",
			terminal: { columns: 120, rows: 20 },
			layoutRoot: root as unknown,
			setLayoutRoot(component: unknown) {
				this.layoutRoot = component;
			},
			requestRender() {},
			showOverlay() {
				return { hide() {} };
			},
		};
		return { root, tui };
	}

	const frame = (root: unknown, width = 120, height = 20) => renderLayoutFrame(root as never, width, height, () => {});
	const mouse = (type: TuiMouseEvent["type"], screenX: number): TuiMouseEvent => ({
		type,
		button: "left",
		x: 0,
		y: 0,
		screenX,
		screenY: 5,
		width: 1,
		height: 20,
		shift: false,
		alt: false,
		ctrl: false,
	});

	test("pi's transcript gets 70% on the left, the panel the rest, the input dock stays full width", () => {
		const { root, tui } = piLayout();
		const saved: unknown[] = [];
		const split = new SplitView({
			tui: tui as unknown as TUI,
			flow: new FlowModel(),
			theme: () => plainTheme,
			prefs: { enabled: true, ratio: 0.7 },
			savePrefs: (prefs) => saved.push({ ...prefs }),
		});
		split.ensure();
		assert.notEqual(tui.layoutRoot, root);
		assert.ok(split.visible);
		const lines = plain(frame(tui.layoutRoot).lines);
		const divider = lines[3]?.search(/[│┃]/) ?? -1;
		assert.equal(divider, Math.floor(119 * 0.7));
		assert.match(lines[0] ?? "", /^transcript line/);
		assert.match(lines.slice(0, 5).join("\n"), /就绪/);
		assert.match(lines.at(-1) ?? "", /^editor here/);

		// Drag the divider to column 60.
		const layout = frame(tui.layoutRoot);
		const box = getLayoutBoxesAt(layout, divider, 5)[0];
		assert.ok(box?.component.handleMouse);
		box.component.handleMouse(mouse("press", divider));
		box.component.handleMouse(mouse("drag", 60));
		box.component.handleMouse(mouse("release", 60));
		assert.equal(plain(frame(tui.layoutRoot).lines)[3]?.search(/[│┃]/), 60);
		assert.deepEqual(saved.at(-1), { enabled: true, ratio: 60 / 119 });

		// Off restores pi's own root; on wraps it again.
		split.setEnabled(false);
		assert.equal(tui.layoutRoot, root);
		assert.ok(!split.visible);
		split.setEnabled(true);
		assert.notEqual(tui.layoutRoot, root);
		split.dispose();
		assert.equal(tui.layoutRoot, root);
	});

	test("a narrow terminal hides the panel; pi replacing its root is wrapped again", () => {
		const { root, tui } = piLayout();
		const split = new SplitView({ tui: tui as unknown as TUI, flow: new FlowModel(), theme: () => plainTheme, prefs: { enabled: true, ratio: 0.7 }, savePrefs() {} });
		split.ensure();
		tui.terminal.columns = 80;
		assert.ok(!split.visible);
		assert.ok(!plain(frame(tui.layoutRoot, 80).lines).some((line) => /[│┃]/.test(line)));
		tui.terminal.columns = 120;
		tui.setLayoutRoot(root); // e.g. after switching TUI mode back and forth
		split.ensure();
		assert.ok(split.visible);
		split.dispose();
	});

	test("the divider keeps both columns usable, and preferences live in 2pi's own file", () => {
		assert.equal(clampRatio(0.95, 120), 1 - 28 / 120);
		assert.equal(clampRatio(0.1, 120), 44 / 120);
		assert.equal(clampRatio(Number.NaN, 120), 0.7);
		const dir = mkdtempSync(join(tmpdir(), "2pi-split-"));
		try {
			assert.deepEqual(readPrefs(dir), { enabled: true, ratio: 0.7 });
			writePrefs(dir, { enabled: false, ratio: 0.6123 });
			assert.deepEqual(readPrefs(dir), { enabled: false, ratio: 0.612 });
			assert.deepEqual(JSON.parse(readFileSync(join(dir, "2pi.json"), "utf8")), { splitView: false, splitRatio: 0.612 });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
