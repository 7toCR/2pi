import { isAbsolute, relative } from "node:path";
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/**
 * One quiet line per tool call instead of pi's coloured boxes with output previews:
 *
 *   ✓ 读取      paper/sections/methods.tex              42 行 · 0.3s
 *   ✗ 命令      latexmk -pdf main.tex                   退出码 12
 *       ! Undefined control sequence.
 *
 * Errors keep their first lines; ctrl+o (or a click) expands a row to pi's own full rendering.
 */

type Args = Record<string, unknown>;
type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type ResultRenderer = NonNullable<ToolRenderers["renderResult"]>;
type RenderContext = Parameters<CallRenderer>[2];
type ToolResult = Parameters<ResultRenderer>[0];
export interface ResultLike {
	content: ReadonlyArray<{ type: string; text?: string }>;
	details?: unknown;
}

interface ToolView {
	verb: string;
	/** What the call works on: a path, a command, a query. */
	target?: (args: Args, cwd: string) => string;
	/** A few words about the outcome, shown after the target. */
	summary?: (text: string, result: ResultLike, args: Args) => string | undefined;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const firstLine = (text: string) => text.split("\n").find((line) => line.trim())?.trim() ?? "";
const nonEmptyLines = (text: string) => text.split("\n").filter((line) => line.trim()).length;

function relPath(path: string, cwd: string): string {
	if (!path) return "";
	const clean = path.replace(/^@/, "");
	if (!isAbsolute(clean)) return clean.replace(/\\/g, "/");
	const rel = relative(cwd, clean).replace(/\\/g, "/");
	return rel && !rel.startsWith("..") ? rel : clean.replace(/\\/g, "/");
}

const pathOf =
	(...keys: string[]) =>
	(args: Args, cwd: string) =>
		relPath(keys.map((key) => str(args[key])).find(Boolean) ?? "", cwd);

const counts = (errors: string | undefined, warnings: string | undefined) =>
	errors === undefined ? undefined : `${errors} 错误 · ${warnings ?? 0} 警告`;

const VIEWS: Record<string, ToolView> = {
	read: {
		verb: "读取",
		// Models pass offset 1 / limit 2000 by habit: only a read that skips ahead names its range.
		target: (args, cwd) => {
			const offset = Number(args.offset ?? 1);
			const range = offset > 1 ? ` 第${offset}${args.limit ? `–${offset + Number(args.limit) - 1}` : ""}行` : "";
			return `${relPath(str(args.path), cwd)}${range}`;
		},
		summary: (text, result) =>
			result.content.some((part) => part.type === "image") ? "图片" : `${text.split("\n").length} 行`,
	},
	write: {
		verb: "写入",
		target: pathOf("path"),
		summary: (_text, _result, args) => `${str(args.content).split("\n").length} 行`,
	},
	edit: {
		verb: "编辑",
		target: pathOf("path"),
		summary: (_text, result) => {
			const diff = str((result.details as { diff?: unknown } | undefined)?.diff);
			if (!diff) return undefined;
			const lines = diff.split("\n");
			return `+${lines.filter((l) => /^\+\s*\d/.test(l)).length} −${lines.filter((l) => /^-\s*\d/.test(l)).length}`;
		},
	},
	bash: {
		verb: "命令",
		target: (args) => oneLine(firstLine(str(args.command))),
		summary: (text) => {
			const last = text.trim().split("\n").filter((l) => l.trim()).at(-1);
			return last ? oneLine(last).slice(0, 60) : "无输出";
		},
	},
	grep: {
		verb: "搜索",
		target: (args, cwd) => `"${str(args.pattern)}"${args.path ? `  ${relPath(str(args.path), cwd)}` : ""}`,
		summary: (text) => (/no matches/i.test(text) ? "无匹配" : `${nonEmptyLines(text)} 处`),
	},
	find: { verb: "查找", target: (args) => str(args.pattern), summary: (text) => `${nonEmptyLines(text)} 项` },
	ls: { verb: "列目录", target: pathOf("path"), summary: (text) => `${nonEmptyLines(text)} 项` },
	paper_ingest: { verb: "解析", target: pathOf("path") },
	update_plan: {
		verb: "计划",
		target: (args) => oneLine(str(args.explanation)),
		summary: (text) => /(\d+)\/(\d+) 完成/.exec(text)?.[0],
	},
	ask_user: { verb: "提问" },
	evidence: {
		verb: "证据账本",
		target: (args) => {
			const n = Array.isArray(args.entries) ? args.entries.length : Array.isArray(args.ids) ? args.ids.length : 0;
			const action = { add: "新增", update: "修改", remove: "删除", list: "查看" }[str(args.action)] ?? str(args.action);
			return n ? `${action} ${n} 条` : action;
		},
	},
	compute_stats: { verb: "计算" },
	pdf_preview: {
		verb: "预览",
		target: (args, cwd) => `${relPath(str(args.pdf), cwd) || "稿件 PDF"}${args.pages ? `  第${str(args.pages)}页` : ""}`,
		summary: (_text, result) => {
			const pages = (result.details as { pages?: unknown[] } | undefined)?.pages;
			return Array.isArray(pages) ? `${pages.length} 页` : undefined;
		},
	},
	report_changes: {
		verb: "说明修改",
		target: (args) => oneLine(str(args.summary)),
		summary: (text) => {
			const n = /本轮修改了 (\d+) 处/.exec(text)?.[1];
			return n ? `${n} 处` : undefined;
		},
	},
	redline: { verb: "修订稿", target: (args) => str(args.spec), summary: (text) => /修改 \d+ 处/.exec(text)?.[0] },
	lit_search: {
		verb: "文献检索",
		target: (args) =>
			`${({ arxiv: "arXiv", crossref: "Crossref" } as Record<string, string>)[str(args.source)] ?? "OpenAlex"}  ${
				str(args.query) || (str(args.citing) ? `引用 ${str(args.citing)} 的文献` : str(args.references_of) ? `${str(args.references_of)} 的参考文献` : "")
			}`,
		summary: (text) => {
			const match = /共 (\S+) 条，显示 (\d+) 条/.exec(text);
			return match ? `${match[2]} 条（共 ${match[1]}）` : undefined;
		},
	},
	lit_fetch: {
		verb: "获取文献",
		target: (args) => str(args.id),
		summary: (text) => (/不存在或未被收录/.test(text) ? "未找到" : firstLine(text).split(" — ")[0]?.slice(0, 50)),
	},
	patent_search: {
		verb: "专利检索",
		target: (args) => str(args.query),
		summary: (text) => {
			if (/没有配置专利检索服务/.test(text)) return "未配置服务，已给出检索链接";
			const match = /共 (\S+) 件，显示 (\d+) 件/.exec(text);
			return match ? `${match[2]} 件（共 ${match[1]}）` : undefined;
		},
	},
	patent_import: { verb: "导入专利", target: pathOf("path"), summary: (text) => /导入 \d+ 件专利/.exec(text)?.[0] },
	check_draft: {
		verb: "论文检查",
		target: pathOf("path", "file", "target"),
		summary: (text) => {
			const match = /(\d+) error\(s\), (\d+) warning\(s\)/.exec(text);
			return counts(match?.[1], match?.[2]);
		},
	},
	latex_compile: {
		verb: "编译",
		target: pathOf("main", "path"),
		summary: (text) => {
			const pages = /\((\d+) page\(s\)\)/.exec(text)?.[1];
			return pages ? `${pages} 页` : undefined;
		},
	},
	paper_init: { verb: "论文骨架", target: (args) => str(args.template) },
	fill_gaps: { verb: "填补缺口" },
	bib_lookup: {
		verb: "核对文献",
		target: pathOf("bib"),
		summary: (text) => {
			const n = /Checked (\d+) entr/.exec(text)?.[1];
			return n ? `${n} 条` : undefined;
		},
	},
	patent_check: {
		verb: "专利检查",
		target: pathOf("json_path"),
		summary: (text) => {
			const match = /(\d+) 个错误，(\d+) 个警告/.exec(text);
			return counts(match?.[1], match?.[2]);
		},
	},
	patent_build: {
		verb: "生成专利",
		target: (args, cwd) => `${relPath(str(args.json_path), cwd)}${Array.isArray(args.stages) ? `  ${args.stages.join("+")}` : ""}`,
	},
};
VIEWS.powershell = { ...VIEWS.bash, verb: "命令" } as ToolView;

/** For tools 2pi does not know: the first short string argument. */
function genericTarget(args: Args, cwd: string): string {
	for (const key of ["path", "file", "json_path", "query", "id", "command", "pattern", "url"]) {
		if (str(args[key])) return key.endsWith("path") || key === "file" ? relPath(str(args[key]), cwd) : oneLine(str(args[key]));
	}
	return "";
}

function resultText(result: ResultLike): string {
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n");
}

function duration(ms: number | undefined): string {
	if (ms === undefined || ms < 1000) return "";
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Pad to a display width (CJK characters take two cells). */
function padCells(text: string, cells: number): string {
	return text + " ".repeat(Math.max(0, cells - visibleWidth(text)));
}

interface RowState {
	summary?: string;
	errorLines?: string[];
}

const EMPTY: Component = { render: () => [], invalidate() {} };

class Lines implements Component {
	private readonly build: (width: number) => string[];
	constructor(build: (width: number) => string[]) {
		this.build = build;
	}
	render(width: number): string[] {
		return this.build(width);
	}
	invalidate(): void {}
}

/** Indent another component's lines (expanded output under its row). */
class Indented implements Component {
	private readonly child: Component;
	private readonly indent: number;
	constructor(child: Component, indent: number) {
		this.child = child;
		this.indent = indent;
	}
	render(width: number): string[] {
		const pad = " ".repeat(this.indent);
		return this.child.render(Math.max(10, width - this.indent)).map((line) => pad + line);
	}
	invalidate(): void {
		this.child.invalidate();
	}
}

/** Error text without pi's trailing status line, which the row already shows. */
function errorDetail(text: string): { summary: string; lines: string[] } {
	const lines = text.split("\n").filter((line) => line.trim());
	const exit = lines.findLast((line) => /^Command (exited with code \d+|timed out|aborted|terminated)/.test(line.trim()));
	const code = exit ? /code (\d+)/.exec(exit)?.[1] : undefined;
	const rest = lines.filter((line) => line !== exit);
	// The lines that say what went wrong, else the last ones (build logs open with banners).
	const telling = rest.filter((line) =>
		/^\s*!|error|exception|traceback|failed|not found|no such|cannot|can't|denied|invalid|not recognized|无法|错误|失败|找不到|不存在/i.test(line),
	);
	return { summary: code ? `退出码 ${code}` : exit ? oneLine(exit) : "失败", lines: (telling.length ? telling : rest).slice(-3) };
}

/** What a call does, in the words of its row: "读取" + "paper/sections/methods.tex". */
export function describeCall(toolName: string, args: Args, cwd: string): { verb: string; target: string } {
	const view = VIEWS[toolName] ?? { verb: toolName };
	return { verb: view.verb, target: (view.target ?? genericTarget)(args, cwd) };
}

/** The few words a finished call's row shows after its target ("42 行", "退出码 12"). */
export function describeResult(toolName: string, result: ResultLike, args: Args, isError: boolean): string | undefined {
	const text = resultText(result);
	const view = VIEWS[toolName] ?? { verb: toolName };
	let summary: string | undefined;
	try {
		summary = view.summary ? view.summary(text, result, args) : undefined;
	} catch {
		summary = undefined;
	}
	if (isError) {
		// A command's exit code says most; a checker's own counts say more than "failed".
		const detail = errorDetail(text).summary;
		return detail !== "失败" || !summary ? detail : summary;
	}
	summary ??= firstLine(text).slice(0, 50) || undefined;
	const images = result.content.filter((part) => part.type === "image").length;
	if (images > 0 && !/图片/.test(summary ?? "")) summary = `${summary ? `${summary} · ` : ""}${images} 张图`;
	return summary;
}

export function compactRenderers(toolName: string, original: ToolRenderers | undefined): ToolRenderers {
	const view = VIEWS[toolName] ?? { verb: toolName };
	return {
		renderShell: "self",
		renderCall: (rawArgs: unknown, theme: Theme, context: RenderContext) => {
			const args = (rawArgs ?? {}) as Args;
			const state = context.state as RowState;
			return new Lines((width) => {
				const pad = " ".repeat(context.outputPad);
				const running = context.isPartial || !context.executionStarted;
				const icon = running ? theme.fg("dim", "…") : context.isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const head = `${pad}${icon} ${theme.fg(context.isError ? "error" : "muted", padCells(view.verb, 8))} `;
				const target = (view.target ?? genericTarget)(args, context.cwd);
				const tail = [
					state.summary && theme.fg(context.isError ? "error" : "muted", state.summary),
					duration(context.durationMs) && theme.fg("dim", duration(context.durationMs)),
				]
					.filter(Boolean)
					.join(theme.fg("dim", " · "));
				const room = width - visibleWidth(head) - (tail ? visibleWidth(tail) + 2 : 0);
				const shown = room >= 8 ? truncateToWidth(target, room, "…") : "";
				return [truncateToWidth(`${head}${shown}${tail ? `  ${tail}` : ""}`, width, "…")];
			});
		},
		renderResult: (result: ToolResult, options, theme: Theme, context: RenderContext) => {
			const state = context.state as RowState;
			const text = resultText(result);
			if (context.isError) {
				state.summary = describeResult(toolName, result, (context.args ?? {}) as Args, true);
				state.errorLines = errorDetail(text).lines;
			} else if (!options.isPartial) {
				state.summary = describeResult(toolName, result, (context.args ?? {}) as Args, false);
				state.errorLines = undefined;
			}
			const indent = context.outputPad + 4;
			if (options.expanded) {
				// The full output, as pi draws it, under the row.
				const full = original?.renderResult?.(result, options, theme, { ...context, lastComponent: undefined });
				if (full) return new Indented(full, indent);
				return new Lines((width) =>
					text
						.split("\n")
						.slice(0, 60)
						.flatMap((line: string) => wrapTextWithAnsi(theme.fg("toolOutput", line), Math.max(10, width - indent)))
						.map((line: string) => " ".repeat(indent) + line),
				);
			}
			if (context.isError && state.errorLines?.length) {
				const lines = state.errorLines;
				return new Lines((width) =>
					lines.map((line) => " ".repeat(indent) + truncateToWidth(theme.fg("error", line.trim()), Math.max(10, width - indent), "…")),
				);
			}
			return EMPTY;
		},
	};
}

/** Compact rows for every tool, built-in or 2pi's. TWOPI_CLASSIC_UI=1 keeps pi's own rendering. */
export function registerCompactToolRows(pi: ExtensionAPI): void {
	pi.registerToolRenderer((toolName, next) => compactRenderers(toolName, next()));
}
