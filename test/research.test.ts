/**
 * P3 research: citation extraction and verification, the literature and patent providers (scripted
 * responses, no network), online permission, the search log, the library, and the citation gate.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { GATE_MESSAGE } from "../src/core/gate.ts";
import { networkRisk } from "../src/core/guard.ts";
import { readSearches, setFetch } from "../src/core/online.ts";
import { readProjectCard } from "../src/core/project.ts";
import { defaultPacks, resolveActivePacks } from "../src/extension.ts";
import { addToLibrary, findCitations, knownCitations, loadLibrary, unverifiedCitations, workKey } from "../src/packs/research/library.ts";
import { abstractFromIndex, arxivQuery, fromOpenAlex, parseArxivFeed, toBibtex } from "../src/packs/research/literature.ts";
import { importPatentCsv, opsQuery, parseOpsSearch, patentSearchLinks } from "../src/packs/research/patents.ts";
import { citationPdfUrl } from "../src/packs/research/tools.ts";
import { BIB, mockFetch } from "./fixtures/crossref.ts";
import { ARXIV_FEED, GOOGLE_PATENTS_CSV, OPENALEX_PREPRINT, OPENALEX_WORK, OPS_SEARCH, researchFetch } from "./fixtures/research.ts";
import { createTestAgent, customMessages, textOf, toolResults } from "./helpers.ts";

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const say = (text: string) => fauxAssistantMessage(text);
const ALLOWED = "- 类型：patent\n- 联网检索：允许\n";

describe("citations", () => {
	test("DOIs, arXiv ids and patent numbers are found; declared ones are skipped", () => {
		const text = [
			"见 doi:10.1109/TSP.2020.123456. 与 arXiv:2101.00001v2",
			"https://arxiv.org/abs/2202.00002 以及 10.48550/arXiv.2101.00003",
			"对比文件 CN100000002A、US 2020000003 A1",
			"线索 doi:10.0000/remembered（待核实）",
		].join("\n");
		assert.deepEqual(
			findCitations(text).map((c) => [c.id, c.line]),
			[
				["doi:10.1109/tsp.2020.123456", 1],
				["doi:10.48550/arxiv.2101.00003", 2],
				["arxiv:2101.00001", 1],
				["arxiv:2202.00002", 2],
				["pn:CN100000002", 3],
				["pn:US2020000003", 3],
			],
		);
		const bib = "@article{a,\n  title = {A},\n  doi = {10.0000/a},\n  note = {待核实}\n}\n@article{b,\n  doi = {10.0000/b}\n}\n";
		assert.deepEqual(
			findCitations(bib, "refs.bib").map((c) => c.id),
			["doi:10.0000/b"],
		);
	});

	test("the library and the author's materials verify citations; anything else is reported", () => {
		const cwd = mkdtempSync(join(tmpdir(), "2pi-cite-"));
		try {
			mkdirSync(join(cwd, "materials"));
			writeFileSync(join(cwd, "materials", "refs.md"), "The author's own reference: doi:10.0000/from.author\n");
			addToLibrary(cwd, { works: [fromOpenAlex(OPENALEX_PREPRINT)] });
			writeFileSync(
				join(cwd, "survey.md"),
				"[1] doi:10.0000/from.author\n[2] arXiv:2101.00001\n[3] doi:10.48550/arxiv.2101.00001\n[4] doi:10.0000/made.up\n",
			);
			const known = knownCitations(cwd);
			assert.ok(known.has("arxiv:2101.00001") && known.has("doi:10.0000/from.author"));
			assert.deepEqual(
				unverifiedCitations(cwd, [join(cwd, "survey.md")], known).map((c) => [c.file, c.line, c.label]),
				[["survey.md", 4, "doi:10.0000/made.up"]],
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

test("network commands are recognized for the guard; ordinary commands are not", () => {
	for (const command of ["curl -s https://api.openalex.org/works?search=x", "Invoke-WebRequest https://example.org", 'python -c "import urllib.request"']) {
		assert.ok(networkRisk(command), command);
	}
	for (const command of ["python scripts/check.py", "pip install requests", "echo curly", "git status"]) {
		assert.equal(networkRisk(command), undefined, command);
	}
});

test("a publisher page's citation_pdf_url is found and made absolute", () => {
	const html = '<head><meta name="citation_title" content="X"><meta content="/content/x.pdf?download=1&amp;v=2" name="citation_pdf_url"></head>';
	assert.equal(citationPdfUrl(html, "https://journal.example/article/1"), "https://journal.example/content/x.pdf?download=1&v=2");
	assert.equal(citationPdfUrl("<meta name=\"citation_title\" content=\"X\">", "https://journal.example/"), undefined);
});

describe("providers", () => {
	test("OpenAlex and arXiv records become library works", () => {
		assert.equal(abstractFromIndex(OPENALEX_WORK.abstract_inverted_index), "Windows are split adaptively");
		const work = fromOpenAlex(OPENALEX_WORK);
		assert.equal(work.key, "doi:10.0000/synthetic.window");
		assert.equal(work.venue, "Journal of Synthetic Signals");
		assert.equal(fromOpenAlex(OPENALEX_PREPRINT).arxiv, "2101.00001");
		const [preprint] = parseArxivFeed(ARXIV_FEED).works;
		assert.equal(preprint?.title, "Synthetic Peak-to-MAD Ratios & Window Rules");
		assert.equal(preprint?.arxiv, "2202.00002");
		assert.deepEqual(preprint?.authors, ["Pat Poe", "Sam Soe"]);
		assert.equal(preprint?.abstract, "We study synthetic window rules.");
		assert.match(toBibtex(preprint!), /^@misc\{poe2022synthetic,[\s\S]*eprint = \{2202\.00002\}/);
		assert.match(toBibtex(work), /^@article\{doe2021adaptive,[\s\S]*journal = \{Journal of Synthetic Signals\}/);
		assert.equal(arxivQuery('wavelet "noise floor" AND window'), 'all:wavelet AND all:"noise floor" AND all:window');
		// Fielded terms are sent as written (all:ti:"… made arXiv answer HTTP 400), operators survive.
		assert.equal(arxivQuery('ti:"Mixtral of Experts"'), 'ti:"Mixtral of Experts"');
		assert.equal(arxivQuery('TI:"Mamba" AND ti:"Selective State Spaces"'), 'ti:"Mamba" AND ti:"Selective State Spaces"');
		assert.equal(arxivQuery('ti:hybrid OR au:dao NOT abs:vision'), "ti:hybrid OR au:dao ANDNOT abs:vision");
		assert.equal(arxivQuery("speech recognition"), "all:speech AND all:recognition");
		// Years narrow the search itself, not only the page that comes back.
		assert.equal(arxivQuery('ti:"Attention Is All You Need"', 2017, 2017), 'ti:"Attention Is All You Need" AND submittedDate:[201701010000 TO 201712312359]');
		assert.equal(arxivQuery("mamba moe", 2023), "(all:mamba AND all:moe) AND submittedDate:[202301010000 TO 999912312359]");
	});

	test("EPO OPS JSON and database CSV exports become library patents", () => {
		const { patents, total } = parseOpsSearch(OPS_SEARCH);
		assert.equal(total, 1);
		assert.deepEqual(
			patents.map((p) => [p.number, p.title, p.applicants, p.date, p.ipc?.[0]]),
			[["CN100000001A", "一种合成振动信号去噪方法", ["Synthetic University"], "2021-03-02", "G06F 17/14 A I"]],
		);
		const google = importPatentCsv(GOOGLE_PATENTS_CSV, "import:materials/g.csv");
		assert.deepEqual(
			google.patents.map((p) => [p.number, p.applicants, p.date]),
			[
				["CN100000002A", ["Synthetic Co., Ltd."], "2019-07-01"],
				["US2020000003A1", ["Synthetic Corp"], "2020-01-02"],
			],
		);
		const cnipa = importPatentCsv("公开（公告）号;发明名称;申请（专利权）人;公开（公告）日\nCN 100000004 B;合成方法;合成大学;2020-02-02\n", "import:x");
		assert.deepEqual(
			cnipa.patents.map((p) => [p.number, p.title, p.applicants]),
			[["CN100000004B", "合成方法", ["合成大学"]]],
		);
		assert.equal(opsQuery("wavelet denoising", 2010, 2020), 'ta all "wavelet denoising" and pd within "2010 2020"');
		assert.equal(opsQuery('ta=wavelet and ic=G06F'), "ta=wavelet and ic=G06F");
		assert.match(patentSearchLinks("wavelet denoising", 2024)[0]?.url ?? "", /patents\.google\.com\/\?q=wavelet%20denoising&before=priority:20241231/);
	});
});

describe("research tools in a session", () => {
	test("without permission nothing is sent; the tool tells the model to ask the user", async () => {
		const fetch = researchFetch();
		const previous = setFetch(fetch);
		const agent = await createTestAgent({ files: { "2PI.md": "- 类型：patent\n" } });
		try {
			agent.setResponses([call("lit_search", { query: "synthetic window" }), say("需要授权")]);
			await agent.session.prompt("调研一下");
			const result = toolResults(agent.session, "lit_search").at(-1);
			assert.ok(result?.isError);
			assert.match(textOf(result), /没有允许联网检索/);
			assert.equal(fetch.calls.length, 0);
			assert.equal(readSearches(agent.cwd).length, 0);
		} finally {
			setFetch(previous);
			agent.cleanup();
		}
	});

	test("searches are logged and stored; the gate catches a reference written from memory", async () => {
		const fetch = researchFetch();
		const previous = setFetch(fetch);
		const agent = await createTestAgent({ files: { "2PI.md": ALLOWED } });
		try {
			const survey = (extra: string) =>
				`# 调研报告\n\n| 文献 | F1 |\n|---|---|\n| [1] Doe 2021 | ● |\n\n## 参考文献\n[1] doi:10.0000/synthetic.window\n[2] ${extra}\n`;
			agent.setResponses([
				call("lit_search", { query: "adaptive window, denoising", year_from: 2015 }),
				call("lit_fetch", { id: "https://doi.org/10.0000/synthetic.window", download_pdf: true }),
				call("write", { path: "research/survey.md", content: survey("Smith 2019. doi:10.0000/made.up") }),
				say("报告写好了"),
				(context) => {
					const last = JSON.stringify(context.messages.at(-1));
					assert.match(last, /引用核验/);
					assert.match(last, /research\/survey\.md:9 doi:10\.0000\/made\.up/);
					return call("write", { path: "research/survey.md", content: survey("Smith 2019（待核实：未检索到）") });
				},
				say("已改为待核实"),
			]);
			await agent.session.prompt("调研 adaptive window denoising");
			assert.equal(agent.pendingResponses(), 0);

			const search = textOf(toolResults(agent.session, "lit_search").at(-1));
			assert.match(search, /OpenAlex：title_and_abstract\.search:adaptive window  denoising,publication_year:2015-/);
			assert.match(search, /\[1\] Adaptive Window Splitting for Synthetic Vibration Denoising — Ann Doe, Rick Roe \(2021, Journal of Synthetic Signals\)，被引 12/);
			const fetched = textOf(toolResults(agent.session, "lit_fetch").at(-1));
			assert.match(fetched, /@article\{doe2021adaptive/);
			assert.match(fetched, /PDF 已保存：\.2pi\/sources\/lit\/doi_10\.0000_synthetic\.window\.pdf/);
			assert.ok(existsSync(join(agent.cwd, ".2pi", "sources", "lit", "doi_10.0000_synthetic.window.pdf")));

			assert.deepEqual(
				readSearches(agent.cwd).map((s) => [s.tool, s.service, s.results]),
				[
					["lit_search", "OpenAlex", 2],
					["lit_fetch", "OpenAlex", 1],
					["lit_fetch", "example.org", 1],
				],
			);
			assert.deepEqual(
				loadLibrary(agent.cwd).works.map((w) => w.key),
				["doi:10.0000/synthetic.window", "doi:10.48550/arxiv.2101.00001"],
			);
			const gates = customMessages(agent.session, GATE_MESSAGE).map(textOf);
			assert.equal(gates.length, 1);
			// Once a library exists, research is an active domain of the project.
			const { active } = resolveActivePacks(agent.cwd, defaultPacks(), readProjectCard(agent.cwd));
			assert.deepEqual(
				active.map((p) => p.id),
				["patent", "research"],
			);
		} finally {
			setFetch(previous);
			agent.cleanup();
		}
	});

	test("when OpenAlex refuses, the search falls back to Crossref and both attempts are logged", async () => {
		const previous = setFetch(researchFetch({ openAlexDown: true }));
		const agent = await createTestAgent({ files: { "2PI.md": ALLOWED } });
		try {
			agent.setResponses([call("lit_search", { query: "synthetic" }), say("ok")]);
			await agent.session.prompt("检索");
			const text = textOf(toolResults(agent.session, "lit_search").at(-1));
			assert.match(text, /OpenAlex 不可用（api\.openalex\.org answered HTTP 429），改用 Crossref/);
			assert.match(text, /A Crossref-Only Synthetic Record/);
			assert.deepEqual(
				readSearches(agent.cwd).map((s) => [s.service, s.error ? "error" : s.results]),
				[
					["OpenAlex", "error"],
					["Crossref", 1],
				],
			);
		} finally {
			setFetch(previous);
			agent.cleanup();
		}
	});

	test("patent search without a service gives links and sends nothing; imported and OPS patents verify citations", async () => {
		const fetch = researchFetch();
		const previous = setFetch(fetch);
		const agent = await createTestAgent({ files: { "2PI.md": ALLOWED, "materials/google.csv": GOOGLE_PATENTS_CSV } });
		const saved = { key: process.env.TWOPI_EPO_OPS_KEY, secret: process.env.TWOPI_EPO_OPS_SECRET };
		try {
			delete process.env.TWOPI_EPO_OPS_KEY;
			delete process.env.TWOPI_EPO_OPS_SECRET;
			agent.setResponses([
				call("patent_search", { query: "vibration denoising window", year_to: 2024 }),
				call("patent_import", { path: "materials/google.csv" }),
				say("导入完成"),
			]);
			await agent.session.prompt("检索专利");
			assert.match(textOf(toolResults(agent.session, "patent_search").at(-1)), /没有配置专利检索服务[\s\S]*patents\.google\.com/);
			assert.equal(fetch.calls.length, 0);
			assert.match(textOf(toolResults(agent.session, "patent_import").at(-1)), /导入 2 件专利/);

			process.env.TWOPI_EPO_OPS_KEY = "synthetic-key";
			process.env.TWOPI_EPO_OPS_SECRET = "synthetic-secret";
			const table = "## 对比文件候选\n候选1：CN100000001A｜Y（初判）\n候选2：CN-100000002-A｜A\n候选3：CN100000009A｜凭记忆\n";
			agent.setResponses([
				call("patent_search", { query: "vibration denoising", year_to: 2024 }),
				call("write", { path: "research/prior-art.md", content: table }),
				say("候选表写好了"),
				say("CN100000009A 仍需核实"),
				say("同上"),
			]);
			await agent.session.prompt("用 EPO 再查一次并写候选表");
			assert.match(textOf(toolResults(agent.session, "patent_search").at(-1)), /EPO OPS：ta all "vibration denoising" and pd within "1900 2024"[\s\S]*CN100000001A 一种合成振动信号去噪方法/);
			const gate = customMessages(agent.session, GATE_MESSAGE).map(textOf).at(-1) ?? "";
			assert.match(gate, /prior-art\.md:4 CN100000009A/);
			assert.doesNotMatch(gate, /CN100000001A|CN-100000002-A/);
			assert.equal(loadLibrary(agent.cwd).patents.length, 3);
		} finally {
			if (saved.key === undefined) delete process.env.TWOPI_EPO_OPS_KEY;
			else process.env.TWOPI_EPO_OPS_KEY = saved.key;
			if (saved.secret === undefined) delete process.env.TWOPI_EPO_OPS_SECRET;
			else process.env.TWOPI_EPO_OPS_SECRET = saved.secret;
			setFetch(previous);
			agent.cleanup();
		}
	});

	test("DOIs bib_lookup confirms at Crossref count as verified", async () => {
		const previous = setFetch(mockFetch);
		const agent = await createTestAgent({ files: { "refs.bib": BIB } });
		try {
			agent.setResponses([call("bib_lookup", { bib: "refs.bib", keys: ["doe2020", "lee2021"] }), say("ok")]);
			await agent.session.prompt("核对参考文献");
			const keys = loadLibrary(agent.cwd).works.map((w) => w.key);
			assert.ok(keys.includes("doi:10.0000/synthetic.1"), keys.join(","));
			assert.ok(!keys.includes("doi:10.0000/missing"));
			assert.equal(workKey({ doi: "https://doi.org/10.0000/SYNTHETIC.1" }), "doi:10.0000/synthetic.1");
		} finally {
			setFetch(previous);
			agent.cleanup();
		}
	});
});

