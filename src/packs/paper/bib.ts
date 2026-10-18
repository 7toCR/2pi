/**
 * Check bibliography records against Crossref, and against DataCite for the DOIs Crossref does not
 * register (arXiv's 10.48550/arXiv.*, Zenodo, figshare). A matching record shows that the reference
 * exists and that the .bib fields are right; it never shows that the cited paper supports the
 * sentence. Nothing found here is written back: candidates for entries without a DOI are only listed.
 */

import { type FetchLike, request } from "../../core/online.ts";

export { type FetchLike, retryDelay } from "../../core/online.ts";

export interface BibEntry {
	type: string;
	key: string;
	fields: Record<string, string>;
}

/** Minimal BibTeX reader: @type{key, name = {..} | ".." | bare, ...}; skips @comment/@string/@preamble. */
export function parseBib(text: string): BibEntry[] {
	const entries: BibEntry[] = [];
	const head = /@(\w+)\s*[{(]\s*([^,\s]*)\s*,/g;
	let m: RegExpExecArray | null;
	while ((m = head.exec(text))) {
		const type = m[1].toLowerCase();
		if (["comment", "string", "preamble"].includes(type)) continue;
		const fields: Record<string, string> = {};
		let i = head.lastIndex;
		while (i < text.length) {
			while (i < text.length && /[\s,]/.test(text[i])) i++;
			if (text[i] === "}" || text[i] === ")") {
				i++;
				break;
			}
			const name = /^([\w-]+)\s*=\s*/.exec(text.slice(i));
			if (!name) break;
			i += name[0].length;
			let value = "";
			if (text[i] === "{") {
				let depth = 0;
				const start = i;
				for (; i < text.length; i++) {
					if (text[i] === "{") depth++;
					else if (text[i] === "}" && --depth === 0) break;
				}
				value = text.slice(start + 1, i);
				i++;
			} else if (text[i] === '"') {
				const end = text.indexOf('"', i + 1);
				value = text.slice(i + 1, end < 0 ? text.length : end);
				i = end < 0 ? text.length : end + 1;
			} else {
				const bare = /^[^,}\s]+/.exec(text.slice(i));
				value = bare?.[0] ?? "";
				i += value.length;
			}
			fields[name[1].toLowerCase()] = value.replace(/\s+/g, " ").trim();
		}
		head.lastIndex = i;
		entries.push({ type, key: m[2], fields });
	}
	return entries;
}

/** Plain lowercase words: LaTeX commands, accents and braces removed. */
export function plain(text: string): string {
	return text
		.replace(/\\[a-zA-Z]+\*?/g, " ")
		.replace(/\\./g, "")
		.replace(/[{}$]/g, "")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/** Word-set overlap (Jaccard) of two titles after plain(). */
export function titleSimilarity(a: string, b: string): number {
	const wa = new Set(plain(a).split(" ").filter(Boolean));
	const wb = new Set(plain(b).split(" ").filter(Boolean));
	if (!wa.size || !wb.size) return 0;
	let common = 0;
	for (const w of wa) if (wb.has(w)) common++;
	return common / (wa.size + wb.size - common);
}

/** Family name of the first author: "Doe, Ann and ..." or "Ann Doe and ...". */
export function firstAuthorFamily(author: string | undefined): string | undefined {
	if (!author) return undefined;
	const first = author.split(/\s+and\s+/i)[0].trim();
	const family = first.includes(",") ? first.split(",")[0] : (first.split(/\s+/).at(-1) ?? "");
	return plain(family) || undefined;
}

export function normalizeDoi(doi: string): string {
	return doi
		.trim()
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
		.replace(/^doi:\s*/i, "")
		.toLowerCase();
}

/** The parts of a Crossref work this check uses. */
export interface CrossrefWork {
	DOI: string;
	title?: string[];
	author?: { family?: string; given?: string; name?: string }[];
	"container-title"?: string[];
	issued?: { "date-parts"?: (number | null)[][] };
	published?: { "date-parts"?: (number | null)[][] };
	"published-print"?: { "date-parts"?: (number | null)[][] };
	"published-online"?: { "date-parts"?: (number | null)[][] };
	type?: string;
}

type DateKey = "issued" | "published" | "published-print" | "published-online";
const DATE_KEYS: DateKey[] = ["issued", "published", "published-print", "published-online"];

/** Every year the record is dated with (issued, online, print): online-first and print can straddle a new year. */
export function workYears(work: CrossrefWork): number[] {
	const years = DATE_KEYS.map((k) => work[k]?.["date-parts"]?.[0]?.[0]).filter((y): y is number => typeof y === "number");
	return [...new Set(years)].sort();
}

export function workYear(work: CrossrefWork): number | undefined {
	return workYears(work)[0];
}

const API = "https://api.crossref.org";

const get = (fetchFn: FetchLike, url: string, timeoutMs: number, signal?: AbortSignal) =>
	request(url, { fetchFn, timeoutMs, signal });

export async function lookupDoi(fetchFn: FetchLike, doi: string, timeoutMs: number, signal?: AbortSignal) {
	const res = await get(fetchFn, `${API}/works/${encodeURIComponent(normalizeDoi(doi))}`, timeoutMs, signal);
	if (res.status === 404) return undefined;
	if (!res.ok) throw new Error(`Crossref answered HTTP ${res.status}`);
	return ((await res.json()) as { message: CrossrefWork }).message;
}

const DATACITE = "https://api.datacite.org";
/** arXiv registers its DOIs at DataCite, so Crossref always answers 404 for them. */
const ARXIV_DOI = /^10\.48550\/arxiv\./i;

interface DataCiteAttributes {
	doi?: string;
	titles?: { title?: string }[];
	creators?: { name?: string; familyName?: string; givenName?: string }[];
	publicationYear?: number | string;
	types?: { resourceTypeGeneral?: string };
}

/** A DataCite record in the shape compareEntry reads. */
export async function lookupDataCite(fetchFn: FetchLike, doi: string, timeoutMs: number, signal?: AbortSignal) {
	const res = await get(fetchFn, `${DATACITE}/dois/${encodeURIComponent(normalizeDoi(doi))}`, timeoutMs, signal);
	if (res.status === 404) return undefined;
	if (!res.ok) throw new Error(`DataCite answered HTTP ${res.status}`);
	const record = ((await res.json()) as { data?: { attributes?: DataCiteAttributes } }).data?.attributes;
	if (!record) return undefined;
	const year = Number(record.publicationYear);
	const work: CrossrefWork = {
		DOI: normalizeDoi(record.doi ?? doi),
		title: (record.titles ?? []).map((t) => t.title ?? "").filter(Boolean),
		author: (record.creators ?? []).map((c) => ({ family: c.familyName, given: c.givenName, name: c.name })),
		type: record.types?.resourceTypeGeneral,
	};
	if (Number.isFinite(year) && year > 0) work.issued = { "date-parts": [[year]] };
	return work;
}

/** The arXiv DOI of an entry that gives only its eprint (eprint = {2312.00752}, archiveprefix = {arXiv}). */
export function eprintDoi(entry: BibEntry): string | undefined {
	const { eprint, archiveprefix, eprinttype } = entry.fields;
	if (!eprint) return undefined;
	const prefix = (archiveprefix ?? eprinttype ?? "").toLowerCase();
	if (prefix && prefix !== "arxiv") return undefined;
	const id = eprint.trim().replace(/^arxiv:\s*/i, "").replace(/v\d+$/i, "");
	return /^\d{4}\.\d{4,5}$/.test(id) ? `10.48550/arxiv.${id}` : undefined;
}

/** Search by the whole reference (title, first author, year, venue): a short title alone matches too much. */
export async function searchReference(fetchFn: FetchLike, entry: BibEntry, timeoutMs: number, signal?: AbortSignal) {
	const f = entry.fields;
	const text = [f.title, firstAuthorFamily(f.author), f.year, f.journal ?? f.booktitle].filter(Boolean).join(" ");
	const query = encodeURIComponent(plain(text)).slice(0, 600);
	const res = await get(fetchFn, `${API}/works?rows=3&query.bibliographic=${query}`, timeoutMs, signal);
	if (!res.ok) throw new Error(`Crossref answered HTTP ${res.status}`);
	return ((await res.json()) as { message: { items: CrossrefWork[] } }).message.items ?? [];
}

export type Registry = "Crossref" | "DataCite";

export type BibStatus = "record-matches" | "fields-differ" | "doi-not-found" | "no-doi" | "lookup-failed";

export interface BibResult {
	key: string;
	status: BibStatus;
	doi?: string;
	/** Where the DOI's record was found. */
	registry?: Registry;
	/** The entry's year, for judging candidates of an entry without a DOI. */
	year?: number;
	differences: string[];
	candidates: { doi: string; title: string; year?: number; firstAuthor?: string; similarity: number }[];
	error?: string;
}

/** Compare a .bib entry with the registry record of its DOI. */
export function compareEntry(entry: BibEntry, work: CrossrefWork, registry: Registry = "Crossref"): string[] {
	const differences: string[] = [];
	const crTitle = work.title?.[0] ?? "";
	const sim = titleSimilarity(entry.fields.title ?? "", crTitle);
	if (!entry.fields.title) differences.push("the .bib entry has no title");
	else if (sim < 0.8) differences.push(`title differs (overlap ${sim.toFixed(2)}): ${registry} has "${crTitle}"`);
	const year = Number.parseInt(entry.fields.year ?? "", 10);
	const crYears = workYears(work);
	if (!Number.isNaN(year) && crYears.length && !crYears.includes(year)) {
		differences.push(`year ${year} vs ${registry} ${crYears.join("/")}`);
	}
	const family = firstAuthorFamily(entry.fields.author);
	const crFirst = work.author?.[0];
	const crFamily = plain(crFirst?.family ?? crFirst?.name ?? "");
	if (family && crFamily && !crFamily.split(" ").includes(family.split(" ").at(-1) ?? family)) {
		differences.push(`first author "${family}" vs ${registry} "${crFamily}"`);
	}
	return differences;
}

export async function checkEntries(
	entries: BibEntry[],
	options: { fetchFn: FetchLike; search: boolean; timeoutMs?: number; signal?: AbortSignal; concurrency?: number },
): Promise<BibResult[]> {
	const timeoutMs = options.timeoutMs ?? 20_000;
	const results: BibResult[] = new Array(entries.length);
	let next = 0;
	const worker = async () => {
		while (next < entries.length) {
			const index = next++;
			const entry = entries[index];
			const base = { key: entry.key, differences: [] as string[], candidates: [] as BibResult["candidates"] };
			try {
				const found = async (doi: string) => {
					const crossref = ARXIV_DOI.test(doi) ? undefined : await lookupDoi(options.fetchFn, doi, timeoutMs, options.signal);
					if (crossref) return { work: crossref, registry: "Crossref" as const };
					const datacite = await lookupDataCite(options.fetchFn, doi, timeoutMs, options.signal);
					return datacite ? { work: datacite, registry: "DataCite" as const } : undefined;
				};
				const compared = (doi: string, hit: { work: CrossrefWork; registry: Registry }): BibResult => {
					const differences = compareEntry(entry, hit.work, hit.registry);
					return { ...base, doi, registry: hit.registry, differences, status: differences.length ? "fields-differ" : "record-matches" };
				};
				const eprint = entry.fields.doi ? undefined : eprintDoi(entry);
				const eprintHit = eprint ? await found(eprint) : undefined;
				if (entry.fields.doi) {
					const doi = normalizeDoi(entry.fields.doi);
					const hit = await found(doi);
					results[index] = hit ? compared(doi, hit) : { ...base, doi, status: "doi-not-found" };
				} else if (eprint && eprintHit) {
					results[index] = compared(eprint, eprintHit);
				} else {
					const candidates =
						options.search && entry.fields.title
							? (await searchReference(options.fetchFn, entry, timeoutMs, options.signal)).map((w) => ({
									doi: w.DOI,
									title: w.title?.[0] ?? "",
									year: workYear(w),
									firstAuthor: w.author?.[0]?.family ?? w.author?.[0]?.name,
									similarity: titleSimilarity(entry.fields.title ?? "", w.title?.[0] ?? ""),
								}))
							: [];
					const year = Number.parseInt(entry.fields.year ?? "", 10);
					results[index] = { ...base, status: "no-doi", candidates, ...(Number.isNaN(year) ? {} : { year }) };
				}
			} catch (error) {
				results[index] = {
					...base,
					status: "lookup-failed",
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 2, entries.length) }, worker));
	return results;
}

export function formatBibResults(results: BibResult[]): string {
	const counts = new Map<BibStatus, number>();
	for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
	const lines = [
		`Checked ${results.length} entr${results.length === 1 ? "y" : "ies"}: ${[...counts].map(([s, n]) => `${n} ${s}`).join(", ")}.`,
	];
	for (const r of results) {
		const at = r.registry === "DataCite" ? ", DataCite" : "";
		if (r.status === "record-matches") lines.push(`${r.key}: record matches (doi:${r.doi}${at}).`);
		else if (r.status === "fields-differ") lines.push(`${r.key}: doi:${r.doi}${at} found, but ${r.differences.join("; ")}.`);
		else if (r.status === "doi-not-found") lines.push(`${r.key}: doi:${r.doi} is registered neither at Crossref nor at DataCite (typo, or no such work).`);
		else if (r.status === "lookup-failed") lines.push(`${r.key}: lookup failed (${r.error}); not checked.`);
		else {
			const best = r.candidates.filter((c) => c.similarity >= 0.6 && (!r.year || !c.year || Math.abs(c.year - r.year) <= 1));
			lines.push(
				best.length
					? `${r.key}: no DOI; possible records: ${best.map((c) => `doi:${c.doi} "${c.title}" (${c.firstAuthor ?? "?"}, ${c.year ?? "?"}, overlap ${c.similarity.toFixed(2)})`).join(" | ")}`
					: `${r.key}: no DOI and no close Crossref record; verify it by hand.`,
			);
		}
	}
	lines.push(
		"A matching record shows the reference exists and its fields are right; it does not show the work supports the sentence that cites it. Possible records for entries without a DOI are leads for the author to confirm: never copy them into the .bib unchecked. Report differences and failed lookups under 待核验事项.",
	);
	return lines.join("\n");
}
