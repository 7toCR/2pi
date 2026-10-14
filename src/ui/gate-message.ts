import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { GATE_MESSAGE } from "../core/gate.ts";

/**
 * The end-of-turn check as one line ("交付前检查 论文 0 错误 2 警告 · 引用 3 处 → 自动修复 1/2"),
 * with the full report under ctrl+o, instead of pi's purple box around the whole text.
 */

export function gateHeadline(text: string): { parts: string[]; status: string; blocking: boolean } {
	const parts: string[] = [];
	const paper = /(\d+) error\(s\), (\d+) warning\(s\)/.exec(text);
	if (paper) parts.push(`论文 ${paper[1]} 错误 ${paper[2]} 警告`);
	const compile = /编译失败|Compilation failed|LaTeX errors?/i.test(text);
	if (compile) parts.push("编译失败");
	const patent = /检查结果：(\d+) 个错误，(\d+) 个警告/.exec(text);
	if (patent) parts.push(`专利 ${patent[1]} 错误 ${patent[2]} 警告`);
	const section = (title: RegExp) => {
		const start = text.search(title);
		if (start < 0) return 0;
		const block = text.slice(start).split(/\n\s*\n/)[0] ?? "";
		return block.split("\n").filter((line) => /^\s*-\s/.test(line)).length;
	};
	const citations = section(/引用核验：/);
	if (citations) parts.push(`引用待核实 ${citations} 处`);
	const todo = section(/还需要你亲自完成：/);
	if (todo) parts.push(`待办 ${todo} 项`);
	const round = /自动修复轮 (\d+)\/(\d+)/.exec(text);
	const exhausted = /轮自动修复已用完/.test(text);
	const status = round ? `自动修复 ${round[1]}/${round[2]}` : exhausted ? "修复轮已用完，问题需在交付时说明" : "无阻断问题";
	return { parts, status, blocking: !!round || exhausted };
}

class GateMessage implements Component {
	private readonly text: string;
	private readonly expanded: boolean;
	private readonly outputPad: number;
	private readonly theme: Theme;
	constructor(text: string, expanded: boolean, outputPad: number, theme: Theme) {
		this.text = text;
		this.expanded = expanded;
		this.outputPad = outputPad;
		this.theme = theme;
	}

	render(width: number): string[] {
		const { theme } = this;
		const pad = " ".repeat(this.outputPad);
		const { parts, status, blocking } = gateHeadline(this.text);
		const mark = blocking ? theme.fg("warning", "◆") : theme.fg("success", "◆");
		const summary = parts.length > 0 ? `  ${theme.fg("muted", parts.join(" · "))}` : "";
		const hint = this.expanded ? "" : `  ${theme.fg("dim", keyHint("app.tools.expand", "详情"))}`;
		const head = `${pad}${mark} ${theme.bold("交付前检查")}${summary}  ${theme.fg(blocking ? "warning" : "dim", status)}${hint}`;
		const lines = ["", truncateToWidth(head, width, "…")];
		if (!this.expanded) return lines;
		const indent = this.outputPad + 2;
		const body = this.text.replace(/^\[交付前检查\]\s*/, "").trim();
		for (const line of body.split("\n")) {
			if (!line.trim()) {
				lines.push("");
				continue;
			}
			for (const wrapped of wrapTextWithAnsi(theme.fg("toolOutput", line), Math.max(10, width - indent))) {
				lines.push(" ".repeat(indent) + wrapped);
			}
		}
		return lines;
	}

	invalidate(): void {}
}

export function registerGateMessage(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(GATE_MESSAGE, (message, options, theme) => {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part) => part.type === "text")
						.map((part) => (part as { text: string }).text)
						.join("\n");
		return new GateMessage(text, options.expanded, options.outputPad, theme);
	});
}
