import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { tool } from "../../core/exec.ts";
import { isInside, slash } from "../../core/paths.ts";
import type { RedlineContext, RedlineOutput } from "../../core/redline.ts";
import { loadPaperConfig } from "./config.ts";
import { compileLatex, detectEngine } from "./latex.ts";

function latexdiff(command: string, oldMain: string, newMain: string, cwd: string, signal?: AbortSignal) {
	return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
		execFile(
			command,
			["--flatten", "--encoding=utf8", "--type=UNDERLINE", oldMain, newMain],
			{ cwd, signal, timeout: 120_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
			(error, stdout, stderr) => resolve({ code: typeof error?.code === "number" ? error.code : error ? -1 : 0, stdout, stderr }),
		);
	});
}

/**
 * A latexdiff PDF of the LaTeX manuscript between the two checkpoints: deleted text struck out in
 * red, added text underlined in blue, compiled like the paper itself. Both versions are restored
 * from the checkpoints into a temporary folder, so the project is never touched.
 */
export async function paperRedline(context: RedlineContext): Promise<RedlineOutput[]> {
	const config = loadPaperConfig(context.cwd);
	if (!config.manuscript?.endsWith(".tex")) return [];
	const project = dirname(config.manuscript);
	const projectRel = slash(relative(context.cwd, project));
	const changed = context.diffs.some(
		(diff) => /\.(tex|bib|sty|cls)$/i.test(diff.path) && isInside(join(context.cwd, diff.path), project),
	);
	if (!changed) return [];
	const label = "论文修订版 PDF（latexdiff）";
	const command = tool("LATEXDIFF", "latexdiff");
	if (!command) return [{ label, note: "未找到 latexdiff（TeX Live 自带；也可设置 TWOPI_LATEXDIFF）" }];
	const engine = detectEngine();
	if (!engine) return [{ label, note: "未找到 LaTeX 引擎（tectonic 或 latexmk）" }];

	const tmp = mkdtempSync(join(tmpdir(), "2pi-latexdiff-"));
	try {
		const restore = (commit: string, into: string) => {
			for (const file of context.checkpoints.listAt(commit, projectRel)) {
				const content = context.checkpoints.readAt(commit, file);
				if (!content) continue;
				const target = join(into, slash(relative(projectRel, file)));
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, content);
			}
		};
		const oldDir = join(tmp, "old");
		const newDir = join(tmp, "new");
		restore(context.from, oldDir);
		restore(context.to, newDir);
		const mainRel = slash(relative(project, config.manuscript));
		if (!existsSync(join(oldDir, mainRel))) return [{ label, note: "起始版本中还没有稿件，没有可对比的旧版" }];
		const diff = await latexdiff(command, join(oldDir, mainRel), join(newDir, mainRel), tmp, context.signal);
		if (diff.code !== 0 || !diff.stdout.includes("\\begin{document}")) {
			return [{ label, note: `latexdiff 失败：${(diff.stderr || diff.stdout).trim().slice(-300)}` }];
		}
		const redlineMain = join(newDir, dirname(mainRel), `${basename(mainRel, ".tex")}-redline.tex`);
		writeFileSync(redlineMain, diff.stdout, "utf8");
		const result = await compileLatex({ main: redlineMain, engine, signal: context.signal });
		if (!result.pdf) {
			const first = result.errors[0];
			return [{ label, note: `修订版编译失败：${first ? `${first.file ?? ""}${first.line ? `:${first.line}` : ""} ${first.message}` : "未生成 PDF"}` }];
		}
		const output = join(context.outDir, "paper-redline.pdf");
		copyFileSync(result.pdf, output);
		copyFileSync(redlineMain, join(context.outDir, "paper-redline.tex"));
		return [{ label, path: output, note: result.ok ? undefined : "编译有警告，PDF 已生成" }];
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}
