import { env } from "../../core/config.ts";
import { getJson, getText } from "../../core/online.ts";
import { normalizeArxiv, normalizeDoi, type Work, workKey } from "./library.ts";

/**
 * Literature providers. OpenAlex is the default (titles, abstracts, venues, citation counts, open
 * access links); arXiv covers the newest preprints; Crossref is the fallback when OpenAlex refuses
 * (its free tier is metered per day). All return library Works.
 */

export type LitSource = "openalex" | "arxiv" | "crossref";

export interface LitQuery {
	query?: string;
	yearFrom?: number;
	yearTo?: number;
	limit: number;
	/** OpenAlex only: works that cite this work (W id). */
	citing?: string;
	/** OpenAlex only: works this work cites (W id). */
	referencedBy?: string;
}

export interface LitResult {
	works: Work[];
	total?: number;
	/** The query exactly as sent, for the search log. */
	sent: string;
}

const now = () => new Date().toISOString();

// --- OpenAlex -----------------------------------------------------------------------------------

const OPENALEX = "https://api.openalex.org";
const OPENALEX_FIELDS =
	"id,doi,display_name,publication_year,type,authorships,primary_location,best_oa_location,cited_by_count,abstract_inverted_index,locations";

interface OpenAlexWork {
	id: string;
	doi?: string | null;
	display_name?: string | null;
	publication_year?: number | null;
	type?: string | null;
	authorships?: { author?: { display_name?: string } }[];
	primary_location?: { source?: { display_name?: string } | null; landing_page_url?: string | null } | null;
	best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
	cited_by_count?: number;
	abstract_inverted_index?: Record<string, number[]> | null;
	locations?: { landing_page_url?: string | null }[];
}

export function abstractFromIndex(index: Record<string, number[]> | null | undefined): string | undefined {
	if (!index) return undefined;
	const words: string[] = [];
	for (const [word, positions] of Object.entries(index)) for (const at of positions) words[at] = word;
	const text = words.filter((w) => w !== undefined).join(" ").trim();
	return text || undefined;
}

export function openAlexId(value: string): string {
	return value.replace(/^https?:\/\/openalex\.org\//i, "").toUpperCase();
}

export function fromOpenAlex(work: OpenAlexWork): Work {
	const doi = work.doi ? normalizeDoi(work.doi) : undefined;
	const arxivUrl = (work.locations ?? [])
		.map((location) => /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i.exec(location.landing_page_url ?? "")?.[1])
		.find(Boolean);
	const arxiv = arxivUrl ?? /^10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i.exec(doi ?? "")?.[1];
	const record: Work = {
		key: "",
		title: work.display_name ?? "(untitled)",
		authors: (work.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
		year: work.publication_year ?? undefined,
		venue: work.primary_location?.source?.display_name ?? undefined,
		type: work.type ?? undefined,
		doi,
		arxiv,
		openalex: openAlexId(work.id),
		citedBy: work.cited_by_count,
		abstract: abstractFromIndex(work.abstract_inverted_index),
		url: work.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : undefined),
		pdfUrl: work.best_oa_location?.pdf_url ?? undefined,
		source: "openalex",
		seen: now(),
	};
	record.key = workKey(record);
	return record;
}

function openAlexParams(params: Record<string, string>): string {
	const key = env("OPENALEX_KEY");
	return new URLSearchParams({ ...params, ...(key ? { api_key: key } : {}) }).toString();
}

export async function searchOpenAlex(q: LitQuery, signal?: AbortSignal): Promise<LitResult> {
	const filters: string[] = [];
	// Commas separate OpenAlex filters, so they cannot appear inside a value.
	if (q.query) filters.push(`title_and_abstract.search:${q.query.replace(/,/g, " ")}`);
	if (q.yearFrom || q.yearTo) filters.push(`publication_year:${q.yearFrom ?? ""}-${q.yearTo ?? ""}`);
	if (q.citing) filters.push(`cites:${openAlexId(q.citing)}`);
	if (q.referencedBy) filters.push(`cited_by:${openAlexId(q.referencedBy)}`);
	const sent = filters.join(",");
	const data = await getJson<{ meta?: { count?: number }; results?: OpenAlexWork[] }>(
		`${OPENALEX}/works?${openAlexParams({ filter: sent, per_page: String(q.limit), select: OPENALEX_FIELDS })}`,
		{ signal },
	);
	return { works: (data.results ?? []).map(fromOpenAlex), total: data.meta?.count, sent };
}

/** One work by DOI, arXiv id or OpenAlex id. */
export async function getOpenAlex(id: string, signal?: AbortSignal): Promise<Work | undefined> {
	const path = /^W\d+$/i.test(id) ? openAlexId(id) : id.startsWith("arxiv:") ? `doi:10.48550/arxiv.${id.slice(6)}` : `doi:${normalizeDoi(id)}`;
	try {
		return fromOpenAlex(
			await getJson<OpenAlexWork>(`${OPENALEX}/works/${encodeURI(path)}?${openAlexParams({ select: OPENALEX_FIELDS })}`, { signal }),
		);
	} catch (error) {
		if (error instanceof Error && /HTTP 404/.test(error.message)) return undefined;
		throw error;
	}
}

// --- arXiv --------------------------------------------------------------------------------------

const ARXIV = "https://export.arxiv.org/api/query";

const unescapeXml = (text: string) =>
	text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => {
	const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
	return match ? unescapeXml(match[1] ?? "").replace(/\s+/g, " ").trim() : undefined;
};

export function parseArxivFeed(xml: string): { works: Work[]; total?: number } {
	const total = Number(tag(xml, "opensearch:totalResults"));
	const works = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
		const entry = match[1] ?? "";
		const id = normalizeArxiv(tag(entry, "id") ?? "");
		const doi = tag(entry, "arxiv:doi");
		const record: Work = {
			key: "",
			title: tag(entry, "title") ?? "(untitled)",
			authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => unescapeXml(m[1] ?? "").trim()),
			year: Number((tag(entry, "published") ?? "").slice(0, 4)) || undefined,
			venue: "arXiv",
			type: "preprint",
			doi: doi ? normalizeDoi(doi) : undefined,
			arxiv: id,
			abstract: tag(entry, "summary"),
			url: `https://arxiv.org/abs/${id}`,
			pdfUrl: `https://arxiv.org/pdf/${id}`,
			source: "arxiv",
			seen: now(),
		};
		record.key = workKey(record);
		return record;
	});
	return { works: works.filter((work) => work.arxiv), total: Number.isFinite(total) ? total : undefined };
}

/** "wavelet denoising \"sliding window\"" → all:wavelet AND all:denoising AND all:"sliding window" */
export function arxivQuery(query: string): string {
	const terms = query.match(/"[^"]+"|\S+/g) ?? [];
	return terms
		.filter((term) => !/^(and|or|not)$/i.test(term))
		.map((term) => `all:${term}`)
		.join(" AND ");
}

export async function searchArxiv(q: LitQuery, signal?: AbortSignal): Promise<LitResult> {
	const sent = arxivQuery(q.query ?? "");
	const xml = await getText(`${ARXIV}?${new URLSearchParams({ search_query: sent, start: "0", max_results: String(q.limit) })}`, {
		signal,
		timeoutMs: 30_000,
	});
	const { works, total } = parseArxivFeed(xml);
	const inYears = works.filter((w) => (!q.yearFrom || (w.year ?? 0) >= q.yearFrom) && (!q.yearTo || (w.year ?? 0) <= q.yearTo));
	return { works: inYears, total, sent };
}

export async function getArxiv(id: string, signal?: AbortSignal): Promise<Work | undefined> {
	const xml = await getText(`${ARXIV}?${new URLSearchParams({ id_list: normalizeArxiv(id), max_results: "1" })}`, {
		signal,
		timeoutMs: 30_000,
	});
	return parseArxivFeed(xml).works[0];
}

// --- Crossref -----------------------------------------------------------------------------------

const CROSSREF = "https://api.crossref.org";

interface CrossrefItem {
	DOI: string;
	title?: string[];
	author?: { family?: string; given?: string; name?: string }[];
	"container-title"?: string[];
	issued?: { "date-parts"?: (number | null)[][] };
	type?: string;
	"is-referenced-by-count"?: number;
	abstract?: string;
	URL?: string;
}

export function fromCrossref(item: CrossrefItem): Work {
	const record: Work = {
		key: "",
		title: item.title?.[0] ?? "(untitled)",
		authors: (item.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
		year: item.issued?.["date-parts"]?.[0]?.[0] ?? undefined,
		venue: item["container-title"]?.[0],
		type: item.type,
		doi: normalizeDoi(item.DOI),
		citedBy: item["is-referenced-by-count"],
		abstract: item.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || undefined,
		url: item.URL ?? `https://doi.org/${item.DOI}`,
		source: "crossref",
		seen: now(),
	};
	record.key = workKey(record);
	return record;
}

export async function searchCrossref(q: LitQuery, signal?: AbortSignal): Promise<LitResult> {
	const filters = [q.yearFrom && `from-pub-date:${q.yearFrom}`, q.yearTo && `until-pub-date:${q.yearTo}`].filter(Boolean).join(",");
	const sent = q.query ?? "";
	const data = await getJson<{ message?: { "total-results"?: number; items?: CrossrefItem[] } }>(
		`${CROSSREF}/works?${new URLSearchParams({ "query.bibliographic": sent, rows: String(q.limit), ...(filters ? { filter: filters } : {}) })}`,
		{ signal },
	);
	return { works: (data.message?.items ?? []).map(fromCrossref), total: data.message?.["total-results"], sent };
}

export async function getCrossref(doi: string, signal?: AbortSignal): Promise<Work | undefined> {
	try {
		const data = await getJson<{ message: CrossrefItem }>(`${CROSSREF}/works/${encodeURIComponent(normalizeDoi(doi))}`, { signal });
		return fromCrossref(data.message);
	} catch (error) {
		if (error instanceof Error && /HTTP 404/.test(error.message)) return undefined;
		throw error;
	}
}

// --- Citation formats ---------------------------------------------------------------------------

/** A BibTeX entry built only from the provider's metadata (nothing filled in). */
export function toBibtex(work: Work): string {
	const family = (work.authors[0] ?? "anon").split(/\s+/).at(-1) ?? "anon";
	const word = (work.title.match(/[A-Za-z]{4,}/)?.[0] ?? "work").toLowerCase();
	const key = `${family.toLowerCase().replace(/[^a-z]/g, "") || "anon"}${work.year ?? ""}${word}`;
	const kind =
		work.type === "proceedings-article"
			? "inproceedings"
			: work.type === "book-chapter"
				? "incollection"
				: work.venue === "arXiv" || (work.type === "preprint" && !work.venue)
					? "misc"
					: "article";
	const field = (name: string, value: string | number | undefined) => (value === undefined || value === "" ? [] : [`  ${name} = {${value}}`]);
	const container = kind === "misc" ? undefined : kind === "article" ? "journal" : "booktitle";
	return [
		`@${kind}{${key},`,
		[
			...field("author", work.authors.join(" and ")),
			...field("title", `{${work.title}}`),
			...(container ? field(container, work.venue) : []),
			...field("year", work.year),
			...field("doi", work.doi),
			...(work.arxiv ? [...field("eprint", work.arxiv), ...field("archiveprefix", "arXiv")] : []),
		].join(",\n"),
		"}",
	].join("\n");
}

/** One line per work for tool output. */
export function describeWork(work: Work, index?: number, abstractChars = 280): string {
	const ids = [work.doi && `doi:${work.doi}`, work.arxiv && `arXiv:${work.arxiv}`, work.openalex].filter(Boolean).join(" · ");
	const authors = work.authors.length > 3 ? `${work.authors.slice(0, 3).join(", ")} et al.` : work.authors.join(", ");
	const head = `${index !== undefined ? `[${index}] ` : ""}${work.title} — ${authors || "?"} (${work.year ?? "?"}${work.venue ? `, ${work.venue}` : ""})${
		work.citedBy !== undefined ? `，被引 ${work.citedBy}` : ""
	}`;
	const abstract = work.abstract ? `\n    ${work.abstract.slice(0, abstractChars)}${work.abstract.length > abstractChars ? "…" : ""}` : "";
	return `${head}\n    ${ids}${abstract}`;
}
