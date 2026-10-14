/**
 * The block model: a document split into the units a reviewer thinks in (a claim, a paragraph,
 * a ledger entry), so a change is reported as "权利要求1 modified" rather than "line 212 changed".
 * Packs contribute extractors for their formats; generic text falls back to paragraphs.
 */

export interface Block {
	/** Stable within one version of the file: "claims/1", "p3", "E12". */
	id: string;
	/** What a reviewer calls it: "权利要求1", "Methods 第3段". */
	title: string;
	text: string;
}

/** Returns the blocks of a file, or undefined when the file is not of this extractor's format. */
export type BlockExtractor = (path: string, content: string) => Block[] | undefined;

/** Paragraphs separated by blank lines; `#` headings give the titles of the paragraphs below them. */
export function markdownBlocks(content: string): Block[] {
	const blocks: Block[] = [];
	let heading = "";
	let count = 0;
	for (const paragraph of content.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
		const text = paragraph.trim();
		if (!text) continue;
		const match = /^#{1,6}\s+(.+)$/.exec(text.split("\n")[0] ?? "");
		if (match && !text.includes("\n")) {
			heading = (match[1] ?? "").trim();
			count = 0;
		}
		count += 1;
		blocks.push({ id: `p${blocks.length + 1}`, title: heading ? `${heading} 第${count}段` : `第${blocks.length + 1}段`, text });
	}
	return blocks;
}

/** The evidence ledger: one block per entry, keyed by its id. */
export function ledgerBlocks(content: string): Block[] | undefined {
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch {
		return undefined;
	}
	const entries = Array.isArray(data) ? data : (data as { entries?: unknown } | null)?.entries;
	if (!Array.isArray(entries)) return undefined;
	return entries
		.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && typeof entry.id === "string")
		.map((entry) => ({
			id: String(entry.id),
			title: `证据账本 ${String(entry.id)}`,
			text: `[${String(entry.class ?? "")}] ${String(entry.claim ?? "")} — ${String(entry.source ?? "")}${entry.note ? `（${String(entry.note)}）` : ""}`,
		}));
}

export function isLedgerFile(path: string): boolean {
	return /(^|[\\/])evidence\.json$/i.test(path);
}

/** Plain prose compared paragraph by paragraph when no pack claims the file. */
const PROSE_FILE = /\.(md|markdown|txt|rst|bib)$/i;

/**
 * How to split a file into blocks: a pack's extractor when one recognizes it, the ledger, or
 * paragraphs for prose. Undefined for everything else (generated SVG, data, code), which change
 * views list as files without comparing them block by block. `content` is one version of the
 * file (either works); the returned function splits any version, an empty one into no blocks.
 */
export function blockSplitter(path: string, content: string, extractors: BlockExtractor[]): ((content: string) => Block[]) | undefined {
	const split = (extract: (text: string) => Block[] | undefined) => (text: string) => (text.trim() ? (extract(text) ?? markdownBlocks(text)) : []);
	for (const extract of extractors) {
		if (extract(path, content)) return split((text) => extract(path, text));
	}
	if (isLedgerFile(path) && ledgerBlocks(content)) return split(ledgerBlocks);
	if (PROSE_FILE.test(path)) return split(markdownBlocks);
	return undefined;
}
