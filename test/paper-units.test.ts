/**
 * Unit tests ported from research2paper (ledger, statistics, LaTeX log parsing, bibliography,
 * PDF page ranges), plus the parts 2pi changed: 2PI.md fields and the merged write guard.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	addEntries,
	emptyLedger,
	extractNumbers,
	ledgerSummary,
	loadLedger,
	removeEntries,
	saveLedger,
	updateEntry,
} from "../src/core/evidence.ts";
import { commandRisk, type WriteContext, writeDecision } from "../src/core/guard.ts";
import { parsePages, rendererArgs } from "../src/core/pdf.ts";
import { ledgerPath } from "../src/core/project.ts";
import { CoreState } from "../src/core/state.ts";
import { compare, describeComparison, exact, fmt, parseTable, readCell, resolveQuantities } from "../src/core/stats.ts";
import {
	checkEntries,
	compareEntry,
	firstAuthorFamily,
	formatBibResults,
	normalizeDoi,
	parseBib,
	plain,
	retryDelay,
	titleSimilarity,
} from "../src/packs/paper/bib.ts";
import { type CheckReport, formatReport } from "../src/packs/paper/checker.ts";
import { initPaperWorkspace, loadPaperConfig } from "../src/packs/paper/config.ts";
import { checkTargets } from "../src/packs/paper/gate.ts";
import { engineArgs, needsUnicodeEngine, parseLatexLog } from "../src/packs/paper/latex.ts";
import { PaperState } from "../src/packs/paper/state.ts";
import { BIB, mockFetch, WORKS } from "./fixtures/crossref.ts";

function withTemp(body: (cwd: string) => void) {
	const cwd = mkdtempSync(join(tmpdir(), "2pi-paper-"));
	try {
		body(cwd);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

const CSV = 'method,test_signals,correctly_denoised,criterion\nSWD,200,160,output SNR >= 20 dB\n"Baseline B",200,150,"output SNR >= 20 dB"\n';

test("stats: rates, percentage points, relative change, ratio and count difference", () => {
	withTemp((cwd) => {
		writeFileSync(join(cwd, "r.csv"), CSV);
		const qs = resolveQuantities(cwd, [
			{ name: "SWD", value: { file: "r.csv", row: "swd", column: "correctly_denoised" }, of: { file: "r.csv", row: "SWD", column: "test_signals" } },
			{ name: "B", value: { file: "r.csv", row: "Baseline B", column: "correctly_denoised" }, of: 200 },
		]);
		assert.equal(qs[0]?.rate, 80);
		assert.equal(qs[1]?.rate, 75);
		const c = compare(qs, "SWD", "B");
		assert.equal(c.difference, 5);
		assert.equal(c.differenceUnit, "percentage points");
		assert.equal(c.countDifference, 10);
		assert.equal(fmt(c.relativeChange ?? 0, 2), "6.67");
		assert.equal(
			describeComparison(c, 2),
			"SWD vs B: difference +5 percentage points; count difference +10; relative change +6.67%; ratio 1.067",
		);
		assert.equal(exact(c.relativeChange ?? 0), "6.66666666667");
		assert.throws(() => readCell(cwd, { file: "r.csv", row: "SWD", column: "accuracy" }), /Columns: method, test_signals/);
		assert.throws(() => readCell(cwd, { file: "r.csv", row: "SWD", column: "criterion" }), /is not a number/);
		assert.deepEqual(parseTable('a,"b, c"\n1,2\n', ","), [["a", "b, c"], ["1", "2"]]);
	});
});

test("ledger: ids, extracted numbers, derived-from checks, update and guarded removal", () => {
	const ledger = emptyLedger();
	const [a, b] = addEntries(ledger, [
		{ claim: "SWD met the criterion for 160 of 200 signals", class: "verified", source: "materials/results.csv" },
		{ claim: "Window length is 256 samples", class: "author-reported", source: "materials/method-notes.md" },
	]);
	assert.equal(a?.id, "E1");
	assert.deepEqual(a?.numbers, ["160", "200"]);
	assert.throws(() => addEntries(ledger, [{ claim: "x 1", class: "verified", source: " " }]), /needs a source/);
	const [c] = addEntries(ledger, [{ claim: "rate 80%", class: "verified", source: "computed", derivedFrom: ["E1"] }]);
	assert.throws(() => removeEntries(ledger, ["E1"]), /E3 are derived from them/);
	updateEntry(ledger, b?.id ?? "", { claim: "Window length is 512 samples" });
	assert.deepEqual(ledger.entries[1]?.numbers, ["512"]);
	removeEntries(ledger, [c?.id ?? ""]);
	assert.equal(ledgerSummary(ledger), "2 entries (1 verified, 1 author-reported)");
	assert.deepEqual(extractNumbers("1,234.5 units and 3.11 and 3.11"), ["1,234.5", "3.11"]);
	withTemp((cwd) => {
		saveLedger(join(cwd, "notes", "evidence.json"), ledger);
		assert.equal(loadLedger(join(cwd, "notes", "evidence.json")).entries.length, 2);
		assert.equal(loadLedger(join(cwd, "absent.json")).entries.length, 0);
	});
});

test("parseLatexLog: file:line errors, TeX errors with l.N, undefined refs/cites, labels, missing files", () => {
	const log = [
		"./sections/methods.tex:12: Undefined control sequence.",
		"! LaTeX Error: File `fig1.png' not found.",
		"",
		"l.40 \\includegraphics{fig1.png}",
		"LaTeX Warning: Reference `sec:x' on page 2 undefined on input line 7.",
		"Package natbib Warning: Citation `doe2020' on page 1 undefined on input line 3.",
		"LaTeX Warning: Label `fig:a' multiply defined.",
		"Overfull \\hbox (12.5pt too wide) in paragraph at lines 10--12",
		"Output written on build/main.pdf (3 pages, 51234 bytes).",
	].join("\n");
	const parsed = parseLatexLog(log, `Warning--I didn't find a database entry for "roe2021"\n`);
	assert.deepEqual(parsed.errors[0], { file: "sections/methods.tex", line: 12, message: "Undefined control sequence." });
	assert.deepEqual(parsed.undefinedReferences, ["sec:x"]);
	assert.deepEqual(parsed.undefinedCitations, ["doe2020", "roe2021"]);
	assert.deepEqual(parsed.multiplyDefinedLabels, ["fig:a"]);
	assert.deepEqual(parsed.missingFiles, ["fig1.png"]);
	assert.equal(parsed.overfullBoxes, 1);
	assert.equal(parsed.pages, 3);
	assert.ok(engineArgs("tectonic", "main.tex", "build", false).includes("--untrusted"));
	assert.ok(engineArgs("latexmk", "main.tex", "build", false).includes("-no-shell-escape"));
	assert.ok(engineArgs("latexmk", "main.tex", "build", true).includes("-xelatex"));
	assert.equal(needsUnicodeEngine("\\usepackage[UTF8]{ctex}"), true);
});

test("formatReport: ERRORs first, INFO only counted, rows capped with a pointer to the full report", () => {
	const finding = (level: "ERROR" | "WARN" | "INFO", code: string) => ({ level, code, where: "line 1", message: `${code} message` });
	const report: CheckReport = {
		path: "draft.md",
		format: "md",
		mode: "manuscript",
		errors: 1,
		warnings: 70,
		findings: [...Array.from({ length: 70 }, () => finding("WARN", "W01")), finding("ERROR", "G01"), finding("INFO", "S04")],
	};
	const lines = formatReport(report, "/tmp/report.json", false).split("\n");
	assert.equal(lines[1], "Summary: 1 error(s), 70 warning(s), 1 info.");
	assert.match(lines[2] ?? "", /^ERROR G01 /);
	assert.match(lines.join("\n"), /\.\.\. 11 more; full report: \/tmp\/report\.json/);
});

test("paper config: 2PI.md Chinese fields, legacy PAPER.md, and layout defaults only when files exist", () => {
	withTemp((cwd) => {
		writeFileSync(join(cwd, "PAPER.md"), "- Journal: Synthetic Letters (SL)\n- Abstract word limit: 250 words\n- Manuscript: `draft/main.tex`\n");
		let config = loadPaperConfig(cwd);
		assert.equal(config.journal, "Synthetic Letters (SL)");
		assert.equal(config.abstractWords, 250);
		assert.equal(config.manuscript, join(cwd, "draft", "main.tex"));
		assert.equal(config.notes, undefined, "layout defaults apply only when the file exists");
		// 2PI.md wins over PAPER.md; trailing （注释） is not part of a value.
		writeFileSync(join(cwd, "2PI.md"), "- 目标期刊：合成期刊\n- 摘要字数上限：200\n- 证据账本：notes/ledger.json（共用）\n");
		config = loadPaperConfig(cwd);
		assert.equal(config.journal, "合成期刊");
		assert.equal(config.abstractWords, 200);
		assert.equal(config.evidence, join(cwd, "notes", "ledger.json"));
		assert.equal(ledgerPath(cwd), join(cwd, "notes", "ledger.json"));
	});
});

test("initPaperWorkspace: LaTeX skeleton, notes, ledger and card; never overwrites; a patent project becomes both", () => {
	withTemp((cwd) => {
		writeFileSync(join(cwd, "2PI.md"), "# 2pi 项目卡\n\n- 类型：patent\n");
		const first = initPaperWorkspace(cwd, "elsarticle", "Synthetic Journal");
		for (const rel of ["paper/main.tex", "paper/sections/methods.tex", "paper/refs.bib", "notes/memo.md", "notes/evidence.json"]) {
			assert.ok(first.created.includes(rel), rel);
		}
		assert.match(readFileSync(join(cwd, "paper", "main.tex"), "utf8"), /elsarticle/);
		assert.match(readFileSync(join(cwd, "2PI.md"), "utf8"), /- 类型：both/);
		assert.ok(existsSync(join(cwd, "materials")));
		const second = initPaperWorkspace(cwd, "article");
		assert.deepEqual(second.created, []);
		assert.match(readFileSync(join(cwd, "paper", "main.tex"), "utf8"), /elsarticle/);
	});
});

test("checkTargets: LaTeX sections and notes map to the main file; a .bib alone is not checked", () => {
	withTemp((cwd) => {
		initPaperWorkspace(cwd, "article");
		writeFileSync(join(cwd, "letter.md"), "# Response\n");
		const state = new PaperState();
		for (const rel of ["paper/sections/methods.tex", "notes/memo.md", "letter.md", "paper/refs.bib"]) state.markUnchecked(join(cwd, rel));
		assert.deepEqual(checkTargets(state, cwd).sort(), [join(cwd, "letter.md"), join(cwd, "paper", "main.tex")].sort());
	});
});

test("write guard: materials blocked; drafts, new and agent files allowed; existing author files need a yes", () => {
	withTemp((cwd) => {
		mkdirSync(join(cwd, "paper"));
		mkdirSync(join(cwd, "notes"));
		writeFileSync(join(cwd, "paper", "Related.md"), "x");
		writeFileSync(join(cwd, "notes", "lab-notes.md"), "x");
		writeFileSync(join(cwd, "author.md"), "x");
		writeFileSync(join(cwd, "mine.md"), "x");
		const core = new CoreState([]);
		core.markCreated(join(cwd, "mine.md"));
		const context: WriteContext = {
			cwd,
			core,
			materials: join(cwd, "materials"),
			agentAreas: [join(cwd, "out")],
			touchedBefore: (path) => path.endsWith("touched.md"),
		};
		const decide = (rel: string) => writeDecision(join(cwd, rel), context).action;
		assert.equal(decide("materials/table.csv"), "block");
		assert.equal(decide(".2pi/history/HEAD"), "block");
		assert.equal(decide(".2pi/scratch/x.txt"), "allow");
		assert.equal(decide("author.md"), "confirm");
		// Without a project card, paper/ and notes/ may hold the author's files (seen in a real project).
		assert.equal(decide("paper/Related.md"), "confirm");
		assert.equal(decide("notes/lab-notes.md"), "confirm");
		assert.equal(decide("mine.md"), "allow");
		assert.equal(decide("new-file.md"), "allow");
		assert.equal(decide("out/main.tex"), "allow");
		writeFileSync(join(cwd, "touched.md"), "x");
		assert.equal(decide("touched.md"), "allow");
	});
	const cwd = join(tmpdir(), "ws");
	const flag = (command: string) => commandRisk(command, cwd);
	assert.ok(flag("rm materials/results.csv"));
	assert.ok(flag("mv materials/a.csv paper/a.csv"));
	assert.ok(flag("echo x > materials/a.txt"));
	assert.ok(flag("Remove-Item .\\materials\\a.csv"));
	assert.equal(flag("cat materials/results.csv"), undefined);
	assert.equal(flag("cp materials/fig1.png paper/figures/"), undefined);
	assert.equal(flag("rm paper/build/main.aux"), undefined);
});

test("bibliography: parsing, field comparison, every Crossref status without network, retry delays", async () => {
	const entries = parseBib(BIB);
	assert.deepEqual(entries.map((e) => e.key), ["doe2020", "roe2019", "lee2021", "nodoi2022", "broken2023"]);
	assert.equal(normalizeDoi(entries[0]?.fields.doi ?? ""), "10.0000/synthetic.1");
	assert.equal(firstAuthorFamily("Rick Roe and Ann Doe"), "roe");
	assert.equal(plain("M\\\"{u}ller's {GPU} \\emph{Study}"), "muller s gpu study");
	assert.equal(titleSimilarity("A {Synthetic} Study", "a synthetic study"), 1);
	assert.deepEqual(compareEntry(entries[1]!, WORKS["10.0000/synthetic.2"]!), ["year 2019 vs Crossref 2015"]);
	const results = await checkEntries(entries, { fetchFn: mockFetch, search: true });
	assert.deepEqual(
		results.map((r) => [r.key, r.status]),
		[
			["doe2020", "record-matches"],
			["roe2019", "fields-differ"],
			["lee2021", "doi-not-found"],
			["nodoi2022", "no-doi"],
			["broken2023", "lookup-failed"],
		],
	);
	const text = formatBibResults(results);
	assert.match(text, /nodoi2022: no DOI; possible records: doi:10\.0000\/synthetic\.3/);
	assert.doesNotMatch(text, /synthetic\.4/);
	assert.equal(retryDelay(0, null), 1000);
	assert.equal(retryDelay(0, "120"), 10_000);
});

test("PDF page ranges and renderer arguments", () => {
	assert.deepEqual(parsePages("1-3,5", 4), [1, 2, 3]);
	assert.throws(() => parsePages("x", 4), /Invalid page range/);
	assert.deepEqual(rendererArgs({ kind: "pdftoppm", command: "pdftoppm" }, "a.pdf", 2, 1400, "out"), [
		"-png",
		"-f",
		"2",
		"-l",
		"2",
		"-scale-to",
		"1400",
		"a.pdf",
		"out",
	]);
});
