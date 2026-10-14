import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePython } from "./config.ts";

/** Same search as the skill's export script, so the agent and the script agree on LibreOffice. */
export function findSoffice(): string | undefined {
	const candidates = [
		process.env.SOFFICE,
		"C:\\Program Files\\LibreOffice\\program\\soffice.exe",
		"C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
		"/Applications/LibreOffice.app/Contents/MacOS/soffice",
	].filter((value): value is string => !!value);
	for (const candidate of candidates) if (existsSync(candidate)) return candidate;
	for (const name of ["soffice", "libreoffice"]) {
		const probe = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8", windowsHide: true });
		const hit = probe.status === 0 ? probe.stdout.split(/\r?\n/)[0]?.trim() : undefined;
		if (hit) return hit;
	}
	return undefined;
}

const WORD_EXPORT = `
$ErrorActionPreference = 'Stop'
$word = $null; $doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($env:TWOPI_DOCX, $false, $true, $false)
  $doc.Repaginate()
  $pages = $doc.ComputeStatistics(2)
  $doc.ExportAsFixedFormat($env:TWOPI_PDF, 17)
  Write-Output "pages=$pages"
} finally {
  if ($null -ne $doc) { $doc.Close(0); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) }
  if ($null -ne $word) { $word.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}`;

/**
 * Export a DOCX to a text PDF with Microsoft Word (Windows only). Used when LibreOffice is
 * missing, so the deliverable is a searchable PDF rather than the image-based review copy.
 */
export function exportWithWord(
	docx: string,
	pdf: string,
	signal?: AbortSignal,
): Promise<{ ok: boolean; pages?: number; error?: string }> {
	if (process.platform !== "win32") return Promise.resolve({ ok: false, error: "仅 Windows 支持 Word 导出" });
	return new Promise((resolvePromise) => {
		const child = spawn(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WORD_EXPORT],
			{ env: { ...process.env, TWOPI_DOCX: docx, TWOPI_PDF: pdf }, windowsHide: true },
		);
		let output = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			output += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			output += chunk;
		});
		const kill = () => child.kill();
		signal?.addEventListener("abort", kill, { once: true });
		const timer = setTimeout(kill, 180_000);
		const done = (result: { ok: boolean; pages?: number; error?: string }) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", kill);
			resolvePromise(result);
		};
		child.on("error", (error) => done({ ok: false, error: error.message }));
		child.on("close", (code) => {
			const pages = Number(/pages=(\d+)/.exec(output)?.[1]);
			if (code === 0 && existsSync(pdf)) done({ ok: true, pages: Number.isFinite(pages) ? pages : undefined });
			else done({ ok: false, error: output.trim().slice(-600) || `退出码 ${code}` });
		});
	});
}

/** Page images (`page-NN.png`) already in a directory, in page order. */
export function listPageImages(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => /^page-\d+\.png$/.test(name))
		.sort()
		.map((name) => join(dir, name));
}

/** Render every PDF page to PNG (pdftoppm, else PyMuPDF). Returns the image paths in page order. */
export function renderPdfPages(pdf: string, outDir: string, dpi = 60): string[] {
	mkdirSync(outDir, { recursive: true });
	const pages = () => listPageImages(outDir);
	if (spawnSync("pdftoppm", ["-v"], { stdio: "ignore", windowsHide: true }).error === undefined) {
		const result = spawnSync("pdftoppm", ["-r", String(dpi), "-png", pdf, join(outDir, "page")], { windowsHide: true });
		if (result.status === 0) return pages();
	}
	try {
		const python = resolvePython();
		const script =
			"import sys, fitz\nd = fitz.open(sys.argv[1])\nfor i, p in enumerate(d, 1): p.get_pixmap(dpi=int(sys.argv[3])).save(f'{sys.argv[2]}/page-{i:02d}.png')";
		const result = spawnSync(python.command, [...python.args, "-c", script, pdf, outDir, String(dpi)], { windowsHide: true });
		if (result.status === 0) return pages();
	} catch {
		// No Python: no previews.
	}
	return [];
}
