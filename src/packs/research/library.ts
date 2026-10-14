import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { slash } from "../../core/paths.ts";
import { ensureStateDir, readProjectFields, STATE_DIR } from "../../core/project.ts";

/**
 * The research library: every work and patent a search, fetch, import or bib_lookup actually
 * returned. A citation is "verified" when its identifier is in the library or in the author's own
 * materials; anything else may have been written from memory, and the gate says so.
 */

export interface Work {
	/** "doi:10.1109/…", "arxiv:2401.01234" or "openalex:W123…" */
	key: string;
	title: string;
	authors: string[];
	year?: number;
	venue?: string;
	type?: string;
	doi?: string;
	arxiv?: string;
	openalex?: string;
	citedBy?: number;
	abstract?: string;
	url?: string;
	pdfUrl?: string;
	/** Where the record came from: "openalex", "arxiv", "crossref". */
	source: string;
	seen: string;
}

export interface Patent {
	/** "pn:CN112345678A" */
	key: string;
	/** Publication number as published, e.g. "CN112345678A". */
	number: string;
	title: string;
	applicants: string[];
	date?: string;
	abstract?: string;
	ipc?: string[];
	url?: string;
	/** "epo-ops" or "import:materials/patents.csv". */
	source: string;
	seen: string;
}

export interface Library {
	works: Work[];
	patents: Patent[];
}

export function libraryPath(cwd: string): string {
	return join(cwd, STATE_DIR, "research", "library.json");
}

export function loadLibrary(cwd: string): Library {
	const path = libraryPath(cwd);
	if (!existsSync(path)) return { works: [], patents: [] };
	try {
		const data = JSON.parse(readFileSync(path, "utf8")) as Partial<Library>;
		return { works: data.works ?? [], patents: data.patents ?? [] };
	} catch {
		return { works: [], patents: [] };
	}
}

function saveLibrary(cwd: string, library: Library): void {
	ensureStateDir(cwd);
	const path = libraryPath(cwd);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(library, null, 1)}\n`, "utf8");
}

export function normalizeDoi(doi: string): string {
	return doi
		.trim()
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
		.replace(/^doi:\s*/i, "")
		.toLowerCase();
}

export function normalizeArxiv(id: string): string {
	return id
		.trim()
		.replace(/^arxiv:\s*/i, "")
		.replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "")
		.replace(/\.pdf$/i, "")
		.replace(/v\d+$/i, "");
}

/** Country code and number without separators or kind code: "CN-112345678-A" → "CN112345678". */
export function normalizePatentNumber(number: string): string {
	const compact = number.toUpperCase().replace(/[\s\-/.,]/g, "");
	const match = /^([A-Z]{2})(\d+)([A-Z]\d?)?$/.exec(compact);
	return match ? `${match[1]}${match[2]}` : compact;
}

export function workKey(work: Pick<Work, "doi" | "arxiv" | "openalex">): string {
	if (work.doi) return `doi:${normalizeDoi(work.doi)}`;
	if (work.arxiv) return `arxiv:${normalizeArxiv(work.arxiv)}`;
	return `openalex:${work.openalex ?? "unknown"}`;
}

function sameWork(a: Work, b: Work): boolean {
	return (
		(!!a.doi && !!b.doi && normalizeDoi(a.doi) === normalizeDoi(b.doi)) ||
		(!!a.arxiv && !!b.arxiv && normalizeArxiv(a.arxiv) === normalizeArxiv(b.arxiv)) ||
		(!!a.openalex && a.openalex === b.openalex)
	);
}

/** Add or update works and patents; fields already known are kept unless the new record has them. */
export function addToLibrary(cwd: string, entries: { works?: Work[]; patents?: Patent[] }): Library {
	const library = loadLibrary(cwd);
	for (const work of entries.works ?? []) {
		const index = library.works.findIndex((known) => sameWork(known, work));
		if (index < 0) library.works.push(work);
		else {
			const merged = { ...library.works[index], ...Object.fromEntries(Object.entries(work).filter(([, v]) => v !== undefined && v !== "")) } as Work;
			merged.key = workKey(merged);
			library.works[index] = merged;
		}
	}
	for (const patent of entries.patents ?? []) {
		const id = normalizePatentNumber(patent.number);
		const index = library.patents.findIndex((known) => normalizePatentNumber(known.number) === id);
		if (index < 0) library.patents.push(patent);
		else library.patents[index] = { ...library.patents[index], ...patent } as Patent;
	}
	saveLibrary(cwd, library);
	return library;
}

export function librarySummary(library: Library): string {
	return `${library.works.length} 篇文献、${library.patents.length} 件专利`;
}

// --- Identifiers in text -------------------------------------------------------------------

export interface Citation {
	/** Normalized: "doi:10.1109/x", "arxiv:2401.01234", "pn:CN112345678". */
	id: string;
	/** As written. */
	label: string;
	line: number;
}

const DOI = /\b10\.\d{4,9}\/[^\s"'<>{}\\，。；、（）【】]+/g;
const ARXIV = /(?:arxiv\s*[:：]?\s*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5})(?:v\d+)?/gi;
const PATENT = /\b(CN|US|EP|WO|JP|KR|DE|GB|FR|TW)[\s-]?((?:19|20)\d{2}\/\d{6}|\d{6,12})(?:[\s-]?[A-Z]\d?)?(?![\dA-Za-z])/g;
/** A citation on a line (a .bib entry) carrying one of these is declared unverified, not claimed. */
const DECLARED = /待核实|未核实|待核验|unverified|\[MISSING/i;

function lineAt(text: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
	return line;
}

/** The text a declaration must appear in: the .bib entry, else the line. */
function contextOf(text: string, index: number, bib: boolean): string {
	if (bib) {
		const start = text.lastIndexOf("@", index);
		const next = text.indexOf("\n@", index);
		return text.slice(Math.max(0, start), next < 0 ? text.length : next);
	}
	const start = text.lastIndexOf("\n", index) + 1;
	const end = text.indexOf("\n", index);
	return text.slice(start, end < 0 ? text.length : end);
}

/** DOIs, arXiv ids and patent publication numbers in a text, except those declared unverified. */
export function findCitations(text: string, path = ""): Citation[] {
	const bib = path.toLowerCase().endsWith(".bib");
	const found: Citation[] = [];
	const add = (id: string, label: string, index: number) => {
		if (DECLARED.test(contextOf(text, index, bib))) return;
		found.push({ id, label, line: lineAt(text, index) });
	};
	for (const match of text.matchAll(DOI)) {
		const doi = match[0].replace(/[.,;:)\]]+$/, "");
		add(`doi:${normalizeDoi(doi)}`, `doi:${doi}`, match.index ?? 0);
	}
	for (const match of text.matchAll(ARXIV)) {
		// arXiv DOIs (10.48550/arXiv.2401.01234) are already covered as DOIs.
		if (/10\.48550\/$/i.test(text.slice(Math.max(0, (match.index ?? 0) - 9), match.index ?? 0))) continue;
		add(`arxiv:${match[1]}`, `arXiv:${match[1]}`, match.index ?? 0);
	}
	for (const match of text.matchAll(PATENT)) {
		add(`pn:${normalizePatentNumber(match[0])}`, match[0], match.index ?? 0);
	}
	return found;
}

/** Normalized ids of a work, including the arXiv id behind an arXiv DOI. */
function workIds(work: Work): string[] {
	const ids = [work.doi && `doi:${normalizeDoi(work.doi)}`, work.arxiv && `arxiv:${normalizeArxiv(work.arxiv)}`];
	const arxivDoi = work.doi && /^10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i.exec(normalizeDoi(work.doi));
	if (arxivDoi?.[1]) ids.push(`arxiv:${arxivDoi[1]}`, `doi:10.48550/arxiv.${arxivDoi[1]}`);
	if (work.arxiv) ids.push(`doi:10.48550/arxiv.${normalizeArxiv(work.arxiv)}`);
	return ids.filter((id): id is string => !!id);
}

const TEXT_EXT = new Set([".md", ".txt", ".tex", ".bib", ".csv", ".json", ".html"]);
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

function scanDir(dir: string, into: Set<string>, depth = 0): void {
	if (!existsSync(dir) || depth > 6) return;
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(path);
		} catch {
			continue;
		}
		if (stat.isDirectory()) scanDir(path, into, depth + 1);
		else if (TEXT_EXT.has(extname(name).toLowerCase()) && stat.size <= MAX_SCAN_BYTES) {
			// Declarations do not matter here: anything the author's material cites counts as given.
			const text = readFileSync(path, "utf8").replace(/待核实|未核实|待核验|unverified|\[MISSING/gi, "");
			for (const citation of findCitations(text, path)) into.add(citation.id);
		}
	}
}

/**
 * Identifiers that count as verified: the library, plus whatever the author's materials and the
 * parsed source papers cite (the author vouches for those; they need no online lookup).
 */
export function knownCitations(cwd: string, library = loadLibrary(cwd)): Set<string> {
	const known = new Set<string>();
	for (const work of library.works) for (const id of workIds(work)) known.add(id);
	for (const patent of library.patents) known.add(`pn:${normalizePatentNumber(patent.number)}`);
	scanDir(join(cwd, readProjectFields(cwd).materials ?? "materials"), known);
	scanDir(join(cwd, STATE_DIR, "sources"), known);
	return known;
}

export interface UnverifiedCitation extends Citation {
	file: string;
}

/** Citations in these files that are neither in the library nor in the author's materials. */
export function unverifiedCitations(cwd: string, files: string[], known = knownCitations(cwd)): UnverifiedCitation[] {
	const out: UnverifiedCitation[] = [];
	for (const file of files) {
		if (!existsSync(file)) continue;
		const text = readFileSync(file, "utf8");
		for (const citation of findCitations(text, file)) {
			if (!known.has(citation.id)) out.push({ ...citation, file: slash(relative(cwd, file)) });
		}
	}
	return out;
}
