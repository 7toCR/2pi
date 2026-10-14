/**
 * Evidence ledger: the skill's evidence sheet as a file (notes/evidence.json by default), so claims
 * and numbers stay traceable across turns and compaction, and the checker can match the paper's
 * numbers against it (check_paper_draft.py --ledger, code V01).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The skill's four evidence classes (SKILL.md, step 2). Numbers of "missing" entries never count as traced. */
export const EVIDENCE_CLASSES = ["verified", "author-reported", "interpretation", "missing"] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export interface EvidenceEntry {
	id: string;
	claim: string;
	class: EvidenceClass;
	/** Where it comes from: file and location, table cell, citation key, or "computed". */
	source: string;
	/** Numbers this entry vouches for, as written. Extracted from the claim when not given. */
	numbers: string[];
	/** For computed values: the entries they were computed from and how. */
	derivedFrom?: string[];
	formula?: string;
	note?: string;
	addedAt: string;
}

export interface Ledger {
	version: 1;
	entries: EvidenceEntry[];
}

const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

export function extractNumbers(text: string): string[] {
	return [...new Set(text.match(NUMBER_RE) ?? [])];
}

export function emptyLedger(): Ledger {
	return { version: 1, entries: [] };
}

export function loadLedger(path: string): Ledger {
	if (!existsSync(path)) return emptyLedger();
	const data = JSON.parse(readFileSync(path, "utf8")) as Partial<Ledger> | EvidenceEntry[];
	const entries = Array.isArray(data) ? data : (data.entries ?? []);
	return { version: 1, entries };
}

export function saveLedger(path: string, ledger: Ledger): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(ledger, null, "\t")}\n`);
}

function nextId(ledger: Ledger): string {
	const max = ledger.entries.reduce((m, e) => Math.max(m, Number(e.id.replace(/^E/, "")) || 0), 0);
	return `E${max + 1}`;
}

export interface NewEntry {
	claim: string;
	class: EvidenceClass;
	source: string;
	numbers?: (string | number)[];
	derivedFrom?: string[];
	formula?: string;
	note?: string;
}

export function addEntries(ledger: Ledger, items: NewEntry[]): EvidenceEntry[] {
	const added: EvidenceEntry[] = [];
	for (const item of items) {
		const claim = item.claim.trim();
		if (!claim) throw new Error("An evidence entry needs a claim.");
		if (!item.source.trim()) throw new Error(`"${claim}" needs a source (file and location, or "computed").`);
		const known = new Set(ledger.entries.map((e) => e.id));
		for (const id of item.derivedFrom ?? []) {
			if (!known.has(id)) throw new Error(`"${claim}" is derived from ${id}, which is not in the ledger.`);
		}
		const entry: EvidenceEntry = {
			id: nextId(ledger),
			claim,
			class: item.class,
			source: item.source.trim(),
			numbers: item.numbers?.length ? item.numbers.map(String) : extractNumbers(claim),
			...(item.derivedFrom?.length ? { derivedFrom: item.derivedFrom } : {}),
			...(item.formula ? { formula: item.formula } : {}),
			...(item.note ? { note: item.note } : {}),
			addedAt: new Date().toISOString(),
		};
		ledger.entries.push(entry);
		added.push(entry);
	}
	return added;
}

export function updateEntry(ledger: Ledger, id: string, changes: Partial<NewEntry>): EvidenceEntry {
	const entry = ledger.entries.find((e) => e.id === id);
	if (!entry) throw new Error(`No evidence entry ${id}.`);
	if (changes.claim !== undefined) entry.claim = changes.claim.trim();
	if (changes.class !== undefined) entry.class = changes.class;
	if (changes.source !== undefined) entry.source = changes.source.trim();
	if (changes.note !== undefined) entry.note = changes.note;
	if (changes.numbers !== undefined) entry.numbers = changes.numbers.map(String);
	else if (changes.claim !== undefined) entry.numbers = extractNumbers(entry.claim);
	return entry;
}

export function removeEntries(ledger: Ledger, ids: string[]): string[] {
	const dependents = ledger.entries.filter((e) => !ids.includes(e.id) && e.derivedFrom?.some((d) => ids.includes(d)));
	if (dependents.length) {
		throw new Error(`Cannot remove ${ids.join(", ")}: ${dependents.map((e) => e.id).join(", ")} are derived from them.`);
	}
	const before = ledger.entries.length;
	ledger.entries = ledger.entries.filter((e) => !ids.includes(e.id));
	if (ledger.entries.length === before) throw new Error(`No evidence entries ${ids.join(", ")}.`);
	return ids;
}

export function formatEntry(e: EvidenceEntry): string {
	const derived = e.derivedFrom?.length ? ` = ${e.formula ?? "computed"} from ${e.derivedFrom.join(", ")}` : "";
	return `${e.id} [${e.class}] ${e.claim} — ${e.source}${derived}${e.note ? ` (${e.note})` : ""}`;
}

export function ledgerSummary(ledger: Ledger): string {
	if (ledger.entries.length === 0) return "empty";
	const counts = new Map<string, number>();
	for (const e of ledger.entries) counts.set(e.class, (counts.get(e.class) ?? 0) + 1);
	return `${ledger.entries.length} entries (${[...counts].map(([c, n]) => `${n} ${c}`).join(", ")})`;
}
