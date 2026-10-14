/** Synthetic responses of OpenAlex, arXiv, Crossref and EPO OPS for research tests (no network). */
import type { FetchLike } from "../../src/core/online.ts";

export const OPENALEX_WORK = {
	id: "https://openalex.org/W1000000001",
	doi: "https://doi.org/10.0000/synthetic.window",
	display_name: "Adaptive Window Splitting for Synthetic Vibration Denoising",
	publication_year: 2021,
	type: "article",
	authorships: [{ author: { display_name: "Ann Doe" } }, { author: { display_name: "Rick Roe" } }],
	primary_location: { source: { display_name: "Journal of Synthetic Signals" }, landing_page_url: "https://example.org/w1" },
	best_oa_location: { pdf_url: "https://example.org/w1.pdf" },
	cited_by_count: 12,
	abstract_inverted_index: { Windows: [0], are: [1], split: [2], adaptively: [3] },
	locations: [{ landing_page_url: "https://example.org/w1" }],
};

export const OPENALEX_PREPRINT = {
	id: "https://openalex.org/W1000000002",
	doi: "https://doi.org/10.48550/arxiv.2101.00001",
	display_name: "A Synthetic Preprint on Noise Floors",
	publication_year: 2021,
	type: "preprint",
	authorships: [{ author: { display_name: "Kim Lee" } }],
	primary_location: { source: null, landing_page_url: "https://arxiv.org/abs/2101.00001" },
	cited_by_count: 1,
	abstract_inverted_index: null,
	locations: [{ landing_page_url: "https://arxiv.org/abs/2101.00001v2" }],
};

export const ARXIV_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2202.00002v3</id>
    <published>2022-02-01T00:00:00Z</published>
    <title>Synthetic Peak-to-MAD Ratios &amp; Window Rules</title>
    <summary>We study synthetic
      window rules.</summary>
    <author><name>Pat Poe</name></author>
    <author><name>Sam Soe</name></author>
  </entry>
</feed>`;

export const CROSSREF_ITEM = {
	DOI: "10.0000/SYNTHETIC.CROSSREF",
	title: ["A Crossref-Only Synthetic Record"],
	author: [{ given: "Lou", family: "Loe" }],
	"container-title": ["Synthetic Letters"],
	issued: { "date-parts": [[2019]] },
	type: "journal-article",
	"is-referenced-by-count": 3,
};

/** OPS JSON with the usual quirks: a single exchange-document not wrapped in an array, "$" values. */
export const OPS_SEARCH = {
	"ops:world-patent-data": {
		"ops:biblio-search": {
			"@total-result-count": "1",
			"ops:search-result": {
				"exchange-documents": {
					"exchange-document": {
						"@country": "CN",
						"@doc-number": "100000001",
						"@kind": "A",
						"bibliographic-data": {
							"publication-reference": {
								"document-id": [
									{ "@document-id-type": "docdb", country: { $: "CN" }, "doc-number": { $: "100000001" }, kind: { $: "A" }, date: { $: "20210302" } },
								],
							},
							"classifications-ipcr": { "classification-ipcr": [{ text: { $: "G06F  17/14        A I" } }] },
							parties: {
								applicants: {
									applicant: [
										{ "@data-format": "epodoc", "applicant-name": { name: { $: "SYNTH UNIV [CN]" } } },
										{ "@data-format": "original", "applicant-name": { name: { $: "Synthetic University" } } },
									],
								},
							},
							"invention-title": [
								{ "@lang": "en", $: "Synthetic vibration denoising method" },
								{ "@lang": "zh", $: "一种合成振动信号去噪方法" },
							],
						},
						abstract: { "@lang": "en", p: { $: "A synthetic method splits windows." } },
					},
				},
			},
		},
	},
};

/** Google Patents CSV export: a "search URL" line, then the header. */
export const GOOGLE_PATENTS_CSV = `search URL:,https://patents.google.com/?q=synthetic
id,title,assignee,inventor/author,priority date,filing/creation date,publication date,grant date,result link,representative figure link
CN-100000002-A,一种合成窗口拆分方法,"Synthetic Co., Ltd.",Ann Doe,2019-01-01,2019-01-02,2019-07-01,,https://patents.google.com/patent/CN100000002A/zh,
US-2020000003-A1,Synthetic noise floor estimation,Synthetic Corp,Kim Lee,2018-05-05,2019-05-05,2020-01-02,,https://patents.google.com/patent/US2020000003A1/en,
`;

export interface MockOptions {
	/** OpenAlex answers 429 (free tier used up). */
	openAlexDown?: boolean;
}

/** Records every URL it is asked for. */
export function researchFetch(options: MockOptions = {}): FetchLike & { calls: string[] } {
	const calls: string[] = [];
	const json = (body: unknown, status = 200) => ({
		status,
		ok: status < 400,
		headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "0" : null) },
		json: async () => body,
		text: async () => JSON.stringify(body),
	});
	const fn = (async (url: string) => {
		calls.push(url);
		const u = new URL(url);
		if (u.host === "api.openalex.org") {
			if (options.openAlexDown) return json({ error: "budget" }, 429);
			if (u.pathname === "/works") return json({ meta: { count: 2 }, results: [OPENALEX_WORK, OPENALEX_PREPRINT] });
			if (decodeURIComponent(u.pathname).includes("10.0000/synthetic.window")) return json(OPENALEX_WORK);
			return json({ error: "not found" }, 404);
		}
		if (u.host === "export.arxiv.org") return { status: 200, ok: true, json: async () => ({}), text: async () => ARXIV_FEED };
		if (u.host === "api.crossref.org") {
			if (u.pathname === "/works") return json({ message: { "total-results": 1, items: [CROSSREF_ITEM] } });
			return json({}, 404);
		}
		if (u.host === "ops.epo.org") {
			if (u.pathname.endsWith("/accesstoken")) return json({ access_token: "synthetic-token", expires_in: "1200" });
			return json(OPS_SEARCH);
		}
		if (u.host === "example.org") {
			return { status: 200, ok: true, json: async () => ({}), arrayBuffer: async () => new TextEncoder().encode("%PDF-1.4 synthetic").buffer };
		}
		throw new Error(`unexpected request: ${url}`);
	}) as FetchLike & { calls: string[] };
	fn.calls = calls;
	return fn;
}
