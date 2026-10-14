import type { AlignedBlock } from "./blockdiff.ts";
import { wordDiff } from "./blockdiff.ts";
import type { ChangeSet } from "./history.ts";
import type { FileDiff } from "./review.ts";

/**
 * A self-contained HTML review page for one turn or a range of turns: every changed block with
 * its word-level diff and the model's reason; unchanged blocks folded away and never marked.
 */

export interface ReviewOutput {
	label: string;
	/** Relative to the review page. */
	href?: string;
	note?: string;
}

export interface ReviewPageInput {
	label: string;
	project: string;
	turns: ChangeSet[];
	files: FileDiff[];
	outputs: ReviewOutput[];
	generatedAt?: Date;
}

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const OP_LABEL: Record<AlignedBlock["status"], string> = { added: "新增", removed: "删除", modified: "修改", unchanged: "" };

function diffHtml(block: AlignedBlock): string {
	if (block.status === "added") return `<ins>${esc(block.after ?? "")}</ins>`;
	if (block.status === "removed") return `<del>${esc(block.before ?? "")}</del>`;
	return wordDiff(block.before ?? "", block.after ?? "")
		.map((s) => (s.op === "=" ? esc(s.text) : s.op === "+" ? `<ins>${esc(s.text)}</ins>` : `<del>${esc(s.text)}</del>`))
		.join("");
}

/** Reasons recorded for blocks across the turns; a later turn's reason follows an earlier one. */
function reasonIndex(turns: ChangeSet[]): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const turn of turns) {
		for (const block of turn.blocks ?? []) {
			if (!block.why) continue;
			const key = `${block.file}\u0000${block.block}`;
			index.set(key, [...(index.get(key) ?? []), block.why]);
		}
	}
	return index;
}

function fileSection(file: FileDiff, reasons: Map<string, string[]>): string {
	const changed = file.blocks.filter((b) => b.status !== "unchanged").length;
	const parts: string[] = [];
	let run: AlignedBlock[] = [];
	const flush = () => {
		if (run.length === 0) return;
		parts.push(
			`<details class="same"><summary>未改动 ${run.length} 段</summary>${run
				.map((b) => `<div class="same-block"><div class="title">${esc(b.title)}</div><div class="text">${esc(b.after ?? "")}</div></div>`)
				.join("")}</details>`,
		);
		run = [];
	};
	for (const block of file.blocks) {
		if (block.status === "unchanged") {
			run.push(block);
			continue;
		}
		flush();
		const why = reasons.get(`${file.path}\u0000${block.block}`);
		parts.push(
			`<article class="block ${block.status}"><header><span class="title">${esc(block.title)}</span><span class="badge ${block.status}">${OP_LABEL[block.status]}</span></header>${
				why ? `<p class="why"><b>为什么：</b>${esc(why.join("；"))}</p>` : ""
			}<div class="text">${diffHtml(block)}</div></article>`,
		);
	}
	flush();
	const status = file.status === "added" ? "新文件" : file.status === "deleted" ? "已删除" : `修改 ${changed} 处`;
	return `<section class="file"><h2>${esc(file.path)} <small>${status}</small></h2>${parts.join("\n")}</section>`;
}

/** Reasons that matched no changed block (often about generated files); more than two are folded. */
function notesHtml(notes: string[]): string {
	const items = notes.map((note) => `<div class="why">备注：${esc(note)}</div>`).join("");
	return notes.length > 2 ? `<details class="same"><summary>备注 ${notes.length} 条</summary>${items}</details>` : items;
}

export function renderReviewPage(input: ReviewPageInput): string {
	const reasons = reasonIndex(input.turns);
	const textFiles = input.files.filter((f) => !f.binary && f.blocks.some((b) => b.status !== "unchanged"));
	const binary = input.files.filter((f) => f.binary);
	const changedBlocks = textFiles.reduce((n, f) => n + f.blocks.filter((b) => b.status !== "unchanged").length, 0);
	const turns = input.turns
		.map(
			(turn) => `<li><b>${esc(turn.id)}</b> <span class="muted">${esc(new Date(turn.time).toLocaleString())}</span><div>${esc(turn.prompt)}</div>${
				turn.summary ? `<div class="why">${esc(turn.summary)}</div>` : ""
			}${notesHtml(turn.notes ?? [])}</li>`,
		)
		.join("");
	const outputs = input.outputs
		.map((o) => `<li>${o.href ? `<a href="${esc(o.href)}">${esc(o.label)}</a>` : esc(o.label)}${o.note ? ` <span class="muted">${esc(o.note)}</span>` : ""}</li>`)
		.join("");
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>修改审阅 ${esc(input.label)}</title>
<style>
:root { --bg:#fbfaf7; --fg:#1d1d1b; --muted:#6b6a64; --card:#ffffff; --line:#e4e1d8; --ins-bg:#dff3e3; --ins-fg:#0f5b25; --del-bg:#fbe1e1; --del-fg:#8a1c1c; --why-bg:#fff6d6; --accent:#2d5b8a; }
@media (prefers-color-scheme: dark) { :root { --bg:#161614; --fg:#ecebe6; --muted:#9a988f; --card:#1f1f1c; --line:#33322d; --ins-bg:#16391f; --ins-fg:#9fe0ae; --del-bg:#41191a; --del-fg:#f3a5a5; --why-bg:#3a3214; --accent:#8db8e6; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.7 "Noto Serif SC", "Source Han Serif SC", "SimSun", Georgia, serif; }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); font-family: ui-monospace, Consolas, monospace; }
h2 small { font-family: system-ui, sans-serif; color: var(--muted); font-weight: normal; margin-left: 8px; }
.muted { color: var(--muted); font-size: 13px; }
.summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0; font-family: system-ui, sans-serif; font-size: 14px; }
.summary span { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; }
ul.turns { padding-left: 18px; }
.block { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 6px; padding: 12px 14px; margin: 12px 0; }
.block.added { border-left-color: var(--ins-fg); } .block.removed { border-left-color: var(--del-fg); }
.block header { display: flex; justify-content: space-between; gap: 8px; font-family: system-ui, sans-serif; font-size: 14px; margin-bottom: 6px; }
.badge { font-size: 12px; padding: 1px 8px; border-radius: 10px; background: var(--line); }
.badge.added { background: var(--ins-bg); color: var(--ins-fg); } .badge.removed { background: var(--del-bg); color: var(--del-fg); }
.text { white-space: pre-wrap; word-break: break-word; }
.why { background: var(--why-bg); border-radius: 4px; padding: 4px 8px; margin: 4px 0; font-family: system-ui, sans-serif; font-size: 13px; }
ins { background: var(--ins-bg); color: var(--ins-fg); text-decoration: none; border-bottom: 1px solid var(--ins-fg); }
del { background: var(--del-bg); color: var(--del-fg); }
details.same { margin: 8px 0; font-family: system-ui, sans-serif; font-size: 13px; color: var(--muted); }
details.same summary { cursor: pointer; }
.same-block { margin: 8px 0 8px 14px; font-family: inherit; }
.same-block .title { font-size: 12px; }
.same-block .text { color: var(--muted); font: 14px/1.7 "Noto Serif SC", "SimSun", serif; }
a { color: var(--accent); }
</style>
</head>
<body>
<main>
<h1>修改审阅 · ${esc(input.label)}</h1>
<div class="muted">${esc(input.project)} · 生成于 ${esc((input.generatedAt ?? new Date()).toLocaleString())}</div>
<div class="summary"><span>修改 ${changedBlocks} 处</span><span>文本文件 ${textFiles.length} 个</span>${binary.length ? `<span>其他文件 ${binary.length} 个</span>` : ""}<span><ins>新增</ins> <del>删除</del></span></div>
<h2 style="font-family:inherit">本次包含的轮次</h2>
<ul class="turns">${turns}</ul>
${outputs ? `<h2 style="font-family:inherit">修订稿</h2><ul>${outputs}</ul>` : ""}
${textFiles.map((file) => fileSection(file, reasons)).join("\n")}
${binary.length ? `<h2 style="font-family:inherit">其他文件（二进制或过大，未逐块比较）</h2><ul>${binary.map((f) => `<li>${esc(f.path)}</li>`).join("")}</ul>` : ""}
</main>
</body>
</html>
`;
}
