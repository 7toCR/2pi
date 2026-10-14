import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cleanPathArg } from "../../../core/paths.ts";
import { ledgerPath } from "../../../core/project.ts";
import { formatTrace, traceAgainstLedger } from "../ledger.ts";
import { clip, runPython } from "../../../core/python.ts";
import type { SkillKnowledge } from "../../../core/skill.ts";
import type { PatentState } from "../state.ts";

export interface CheckOutcome {
	errors: number;
	warnings: number;
	report: string;
}

/** Run check_patent_draft.py and record the result for the finish gate. */
export async function runCheck(
	skill: SkillKnowledge,
	state: PatentState,
	jsonPath: string,
	signal: AbortSignal | undefined,
): Promise<CheckOutcome> {
	if (!existsSync(jsonPath)) throw new Error(`文件不存在：${jsonPath}`);
	const reportPath = join(tmpdir(), `2pi-check-${process.pid}-${Date.now()}.json`);
	try {
		const run = await runPython(join(skill.scriptsDir, "check_patent_draft.py"), [jsonPath, "--json", reportPath], {
			cwd: dirname(jsonPath),
			signal,
		});
		if (!existsSync(reportPath)) {
			throw new Error(`检查脚本未能运行（退出码 ${run.code}）：${(run.stderr || run.stdout).trim().slice(-2000)}`);
		}
		const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as { errors: number; warnings: number };
		const outcome = { errors: parsed.errors, warnings: parsed.warnings, report: run.stdout.trim() };
		state.recordCheck(jsonPath, { errors: outcome.errors, warnings: outcome.warnings });
		return outcome;
	} finally {
		rmSync(reportPath, { force: true });
	}
}

/** The ledger cross-check for a patent JSON, when the project has an evidence ledger. */
export function ledgerTraceText(cwd: string, jsonPath: string): string | undefined {
	try {
		const data = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
		const trace = traceAgainstLedger(data, ledgerPath(cwd));
		return trace ? formatTrace(trace) : undefined;
	} catch {
		// Invalid JSON is reported by the checker itself.
		return undefined;
	}
}

export function checkAdvice(outcome: CheckOutcome): string {
	if (outcome.errors > 0) return `存在 ${outcome.errors} 个 ERROR：逐条修复后重新运行 patent_check。`;
	if (outcome.warnings > 0) {
		return "没有 ERROR。逐条判断 WARN：能修改的修改；有理由保留的，在 notes 中写明理由。";
	}
	return "检查通过。";
}

export function registerCheckTool(pi: ExtensionAPI, skill: SkillKnowledge, state: PatentState): void {
	pi.registerTool({
		name: "patent_check",
		label: "Patent Check",
		description:
			"对 patent.json 运行形式与范围自检（check_patent_draft.py）：单句号、不确定用语、引用关系、引用基础、摘要字数、附图编号、附图标记等 ERROR，以及权利要求1过长或列举过多、权利要求中出现代码字段名、校验/迭代机制未画进附图、说明书夹带撰写备注等 WARN。每次修改 patent.json 后都应运行。",
		promptSnippet: "对 patent.json 做形式与范围自检",
		parameters: Type.Object({
			json_path: Type.String({ description: "专利 JSON 路径，例如 patent/patent.json" }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const jsonPath = resolve(ctx.cwd, cleanPathArg(params.json_path));
			const outcome = await runCheck(skill, state, jsonPath, signal);
			const trace = ledgerTraceText(ctx.cwd, jsonPath);
			return {
				content: [
					{ type: "text", text: [clip(outcome.report), checkAdvice(outcome), ...(trace ? [trace] : [])].join("\n\n") },
				],
				details: { jsonPath, errors: outcome.errors, warnings: outcome.warnings },
			};
		},
	});
}
