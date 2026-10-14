import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { blockSegments } from "../../core/blockdiff.ts";
import { AGENT_ROOT } from "../../core/config.ts";
import { runPython } from "../../core/python.ts";
import type { RedlineContext, RedlineOutput } from "../../core/redline.ts";
import { patentPart } from "./blocks.ts";

const PARTS = [
	["abstract", "说明书摘要"],
	["claims", "权利要求书"],
	["description", "说明书"],
	["drawings", "说明书附图（节点与连线）"],
	["notes", "撰写说明相关（不属于申请文件）"],
] as const;

/**
 * A tracked-changes DOCX for every changed patent JSON: the whole application in order, changed
 * text as Word revisions (accept or reject one by one), the model's reasons as Word comments.
 */
export async function patentRedline(context: RedlineContext): Promise<RedlineOutput[]> {
	const outputs: RedlineOutput[] = [];
	const reasons = new Map<string, string[]>();
	for (const turn of context.turns) {
		for (const block of turn.blocks ?? []) {
			if (!block.why) continue;
			const key = `${block.file}\u0000${block.block}`;
			reasons.set(key, [...(reasons.get(key) ?? []), block.why]);
		}
	}
	for (const diff of context.diffs) {
		const isPatent = diff.blocks.some((b) => b.block.startsWith("claims/") || b.block === "abstract" || b.block === "name");
		if (diff.binary || !isPatent || !diff.blocks.some((b) => b.status !== "unchanged")) continue;
		const paragraphs = new Map<string, Array<{ segments: unknown[]; comment?: string }>>();
		for (const block of diff.blocks) {
			const part = patentPart(block.block);
			const why = reasons.get(`${diff.path}\u0000${block.block}`);
			const list = paragraphs.get(part) ?? [];
			list.push({ segments: blockSegments(block), ...(why ? { comment: why.join("；") } : {}) });
			paragraphs.set(part, list);
		}
		const name = diff.blocks.find((b) => b.block === "name");
		const title = `${name?.after ?? name?.before ?? basename(diff.path)} —— 修订稿（${context.label}）`;
		const data = {
			title,
			author: "2pi",
			date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
			sections: PARTS.map(([part, heading]) => ({ heading, paragraphs: paragraphs.get(part) ?? [] })).filter((s) => s.paragraphs.length > 0),
		};
		const stem = basename(diff.path, ".json").replace(/\.patent$/, "");
		const output = join(context.outDir, `${stem}-redline.docx`);
		const tmp = mkdtempSync(join(tmpdir(), "2pi-redline-"));
		try {
			const input = join(tmp, "redline.json");
			writeFileSync(input, JSON.stringify(data), "utf8");
			const run = await runPython(join(AGENT_ROOT, "python", "redline_docx.py"), [input, output], { cwd: context.cwd, signal: context.signal });
			if (run.code !== 0) {
				outputs.push({ label: `专利修订稿（${diff.path}）`, note: `生成失败：${(run.stderr || run.stdout).trim().slice(-300)}` });
				continue;
			}
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
		outputs.push({ label: `专利修订稿 DOCX（Word 修订模式，${diff.path}）`, path: output });
	}
	return outputs;
}
