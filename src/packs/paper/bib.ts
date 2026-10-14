/**
 * Check bibliography records against Crossref. A matching record shows that the reference exists
 * and that the .bib fields are right; it never shows that the cited paper supports the sentence.
 * Nothing found here is written back: candidates for entries without a DOI are only listed.
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

/** Search by the whole reference (title, first author, year, venue): a short title alone matches too much. */
export async function searchReference(fetchFn: FetchLike, entry: BibEntry, timeoutMs: number, signal?: AbortSignal) {
	const f = entry.fields;
	const text = [f.title, firstAuthorFamily(f.author), f.year, f.journal ?? f.booktitle].filter(Boolean).join(" ");
	const query = encodeURIComponent(plain(text)).slice(0, 600);
	const res = await get(fetchFn, `${API}/works?rows=3&query.bibliographic=${query}`, timeoutMs, signal);
	if (!res.ok) throw new Error(`Crossref answered HTTP ${res.status}`);
	return ((await res.json()) as { message: { items: CrossrefWork[] } }).message.items ?? [];
}

export type BibStatus = "record-matches" | "fields-differ" | "doi-not-found" | "no-doi" | "lookup-failed";

export interface BibResult {
	key: string;
	status: BibStatus;
	doi?: string;
	differences: string[];
	candidates: { doi: string; title: string; year?: number; firstAuthor?: string; similarity: number }[];
	error?: string;
}

/** Compare a .bib entry with the Crossref record of its DOI. */
export function compareEntry(entry: BibEntry, work: CrossrefWork): string[] {
	const differences: string[] = [];
	const crTitle = work.title?.[0] ?? "";
	const sim = titleSimilarity(entry.fields.title ?? "", crTitle);
	if (!entry.fields.title) differences.push("the .bib entry has no title");
	else if (sim < 0.8) differences.push(`title differs (overlap ${sim.toFixed(2)}): Crossref has "${crTitle}"`);
	const year = Number.parseInt(entry.fields.year ?? "", 10);
	const crYears = workYears(work);
	if (!Number.isNaN(year) && crYears.length && !crYears.includes(year)) {
		differences.push(`year ${year} vs Crossref ${crYears.join("/")}`);
	}
	const family = firstAuthorFamily(entry.fields.author);
	const crFirst = work.author?.[0];
	const crFamily = plain(crFirst?.family ?? crFirst?.name ?? "");
	if (family && crFamily && !crFamily.split(" ").includes(family.split(" ").at(-1) ?? family)) {
		differences.push(`first author "${family}" vs Crossref "${crFamily}"`);
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
				if (entry.fields.doi) {
					const doi = normalizeDoi(entry.fields.doi);
					const work = await lookupDoi(options.fetchFn, doi, timeoutMs, options.signal);
					if (!work) {
						results[index] = { ...base, doi, status: "doi-not-found" };
						continue;
					}
					const differences = compareEntry(entry, work);
					results[index] = { ...base, doi, differences, status: differences.length ? "fields-differ" : "record-matches" };
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
					results[index] = { ...base, status: "no-doi", candidates };
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
		if (r.status === "record-matches") lines.push(`${r.key}: record matches (doi:${r.doi}).`);
		else if (r.status === "fields-differ") lines.push(`${r.key}: doi:${r.doi} found, but ${r.differences.join("; ")}.`);
		else if (r.status === "doi-not-found") lines.push(`${r.key}: doi:${r.doi} is not registered at Crossref (typo, non-Crossref DOI, or no such work).`);
		else if (r.status === "lookup-failed") lines.push(`${r.key}: lookup failed (${r.error}); not checked.`);
		else {
			const best = r.candidates.filter((c) => c.similarity >= 0.6);
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
