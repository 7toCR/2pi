import { env } from "../../core/config.ts";
import { getJson, request } from "../../core/online.ts";
import type { Patent } from "./library.ts";

/**
 * Patent sources. EPO OPS (free registration; worldwide DOCDB data including CN) when its keys are
 * set; otherwise ready-made search links for the user and an importer for the CSV the databases
 * export. Every patent the agent may cite comes from one of these, never from memory.
 */

const now = () => new Date().toISOString();

export function opsConfigured(): boolean {
	return !!(env("EPO_OPS_KEY") && env("EPO_OPS_SECRET"));
}

/** CQL as written when it already uses CQL syntax; else all words in title or abstract. */
export function opsQuery(query: string, yearFrom?: number, yearTo?: number): string {
	const raw = /[=<>]|\b(all|any|within|prox)\b/i.test(query);
	let cql = raw ? query : `ta all "${query.replace(/"/g, "")}"`;
	if (yearFrom || yearTo) cql += ` and pd within "${yearFrom ?? 1900} ${yearTo ?? new Date().getFullYear()}"`;
	return cql;
}

type Json = Record<string, unknown>;
const list = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const text = (value: unknown): string =>
	typeof value === "string" ? value : value && typeof value === "object" ? String((value as Json).$ ?? "") : "";
const at = (value: unknown, ...path: string[]): unknown =>
	path.reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Json)[key] : undefined), value);

function findAll(node: unknown, key: string, into: Json[] = []): Json[] {
	if (Array.isArray(node)) for (const item of node) findAll(item, key, into);
	else if (node && typeof node === "object") {
		for (const [name, value] of Object.entries(node as Json)) {
			if (name !== key) {
				findAll(value, key, into);
				continue;
			}
			for (const item of list(value)) if (item && typeof item === "object") into.push(item as Json);
		}
	}
	return into;
}

/** OPS biblio search results (JSON) → patents. Tolerates the single-item-not-array quirks of OPS JSON. */
export function parseOpsSearch(data: unknown): { patents: Patent[]; total?: number } {
	const total = Number(at(data, "ops:world-patent-data", "ops:biblio-search", "@total-result-count"));
	const patents = findAll(data, "exchange-document").map((doc): Patent => {
		const bib = doc["bibliographic-data"];
		const number = `${doc["@country"] ?? ""}${doc["@doc-number"] ?? ""}${doc["@kind"] ?? ""}`;
		const titles = list(at(bib, "invention-title")) as Json[];
		const title = text(titles.find((t) => t["@lang"] === "zh") ?? titles.find((t) => t["@lang"] === "en") ?? titles[0]);
		const applicants = list(at(bib, "parties", "applicants", "applicant")) as Json[];
		const preferred = applicants.filter((a) => a["@data-format"] === "original");
		const names = (preferred.length ? preferred : applicants).map((a) => text(at(a, "applicant-name", "name")).trim()).filter(Boolean);
		const ids = list(at(bib, "publication-reference", "document-id")) as Json[];
		const date = ids.map((id) => text(id.date)).find(Boolean);
		const abstracts = list(doc.abstract) as Json[];
		const abstract = abstracts.find((a) => a["@lang"] === "en") ?? abstracts[0];
		const ipc = (list(at(bib, "classifications-ipcr", "classification-ipcr")) as Json[])
			.map((c) => text(c.text).replace(/\s+/g, " ").trim())
			.filter(Boolean);
		return {
			key: `pn:${number}`,
			number,
			title: title || "(no title)",
			applicants: [...new Set(names)],
			date: date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : undefined,
			abstract: abstract ? list(abstract.p).map(text).join(" ").trim() || undefined : undefined,
			ipc: ipc.length ? ipc : undefined,
			url: `https://worldwide.espacenet.com/patent/search?q=pn%3D${number}`,
			source: "epo-ops",
			seen: now(),
		};
	});
	return { patents: patents.filter((p) => /^[A-Z]{2}\d/.test(p.number)), total: Number.isFinite(total) ? total : undefined };
}

let token: { value: string; expires: number } | undefined;

async function opsToken(signal?: AbortSignal): Promise<string> {
	if (token && token.expires > Date.now() + 30_000) return token.value;
	const credentials = Buffer.from(`${env("EPO_OPS_KEY")}:${env("EPO_OPS_SECRET")}`).toString("base64");
	const res = await request("https://ops.epo.org/3.2/auth/accesstoken", {
		method: "POST",
		body: "grant_type=client_credentials",
		headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
		signal,
	});
	if (!res.ok) throw new Error(`EPO OPS refused the credentials (HTTP ${res.status}); check TWOPI_EPO_OPS_KEY / TWOPI_EPO_OPS_SECRET`);
	const data = (await res.json()) as { access_token?: string; expires_in?: string | number };
	if (!data.access_token) throw new Error("EPO OPS returned no access token");
	token = { value: data.access_token, expires: Date.now() + Number(data.expires_in ?? 1200) * 1000 };
	return token.value;
}

export async function searchOps(cql: string, limit: number, signal?: AbortSignal): Promise<{ patents: Patent[]; total?: number }> {
	const access = await opsToken(signal);
	const url = `https://ops.epo.org/3.2/rest-services/published-data/search/biblio?${new URLSearchParams({ q: cql, Range: `1-${limit}` })}`;
	try {
		return parseOpsSearch(await getJson(url, { signal, headers: { Authorization: `Bearer ${access}` } }));
	} catch (error) {
		// OPS answers 404 when nothing matches.
		if (error instanceof Error && /HTTP 404/.test(error.message)) return { patents: [], total: 0 };
		throw error;
	}
}

/** Links that run the same search in the public web interfaces; nothing is sent by building them. */
export function patentSearchLinks(query: string, yearTo?: number): { name: string; url: string }[] {
	const plain = query.replace(/\s+/g, " ").trim();
	return [
		{
			name: "Google Patents",
			url: `https://patents.google.com/?q=${encodeURIComponent(plain)}${yearTo ? `&before=priority:${yearTo}1231` : ""}`,
		},
		{ name: "Espacenet", url: `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(plain)}` },
		{ name: "国家知识产权局 专利检索及分析系统（需登录，手动输入检索式）", url: "https://pss-system.cponline.cnipa.gov.cn/" },
	];
}

// --- CSV exports --------------------------------------------------------------------------------

/** RFC 4180 CSV with the delimiter guessed from the header (comma, semicolon or tab). */
export function parseCsv(content: string): string[][] {
	const textBody = content.replace(/^﻿/, "");
	const firstLines = textBody.split(/\r?\n/).slice(0, 3).join("\n");
	const delimiter = [",", ";", "\t"].sort((a, b) => firstLines.split(b).length - firstLines.split(a).length)[0] ?? ",";
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < textBody.length; i++) {
		const ch = textBody[i];
		if (quoted) {
			if (ch === '"' && textBody[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === delimiter) {
			row.push(cell);
			cell = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && textBody[i + 1] === "\n") i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else cell += ch;
	}
	if (cell || row.length) rows.push([...row, cell]);
	return rows.filter((r) => r.some((c) => c.trim()));
}

const COLUMNS: Record<"number" | "title" | "applicants" | "date" | "abstract" | "url" | "ipc", RegExp> = {
	number: /^(id|publication\s*number|patent\s*number|公开（公告）号|公开\(公告\)号|公开号|公告号|文献号)$/i,
	title: /^(title|标题|名称|发明名称)$/i,
	applicants: /^(assignee|applicants?|申请人|申请（专利权）人|申请\(专利权\)人|专利权人)$/i,
	date: /^(publication\s*date|公开（公告）日|公开\(公告\)日|公开日|公告日)$/i,
	abstract: /^(abstract|摘要)$/i,
	url: /^(result\s*link|link|url|链接)$/i,
	ipc: /^(ipc|ipc分类号|ipc主分类号|分类号)$/i,
};

/** Normalize "CN-112345678-A", "CN 112345678 (A)" → "CN112345678A". */
export function compactPatentNumber(value: string): string {
	return value.toUpperCase().replace(/[\s\-()（）]/g, "");
}

/**
 * Patents from a database's CSV export (Google Patents, Espacenet, or a CNIPA list saved as CSV):
 * the header row is found by its column names, so preamble lines are skipped.
 */
export function importPatentCsv(content: string, source: string): { patents: Patent[]; skipped: number; columns: string[] } {
	const rows = parseCsv(content);
	const headerIndex = rows.findIndex((row) => row.some((cell) => COLUMNS.number.test(cell.trim())));
	if (headerIndex < 0) throw new Error("找不到公开号列（id / publication number / 公开号）；请导出含公开号的 CSV。");
	const header = (rows[headerIndex] ?? []).map((cell) => cell.trim());
	const column = (name: keyof typeof COLUMNS) => header.findIndex((cell) => COLUMNS[name].test(cell));
	const index = Object.fromEntries((Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).map((name) => [name, column(name)])) as Record<
		keyof typeof COLUMNS,
		number
	>;
	const cellOf = (row: string[], name: keyof typeof COLUMNS) => (index[name] >= 0 ? (row[index[name]] ?? "").trim() : "");
	const patents: Patent[] = [];
	let skipped = 0;
	for (const row of rows.slice(headerIndex + 1)) {
		const number = compactPatentNumber(cellOf(row, "number").split(/[\n;]/)[0] ?? "");
		if (!/^[A-Z]{2}\d{5,}/.test(number)) {
			skipped++;
			continue;
		}
		// Names may contain commas ("Co., Ltd."): only line breaks and semicolons separate them.
		const split = (value: string) =>
			value
				.split(/[\n;；]/)
				.map((s) => s.trim())
				.filter(Boolean);
		patents.push({
			key: `pn:${number}`,
			number,
			title: cellOf(row, "title") || "(no title)",
			applicants: split(cellOf(row, "applicants")),
			date: cellOf(row, "date") || undefined,
			abstract: cellOf(row, "abstract") || undefined,
			ipc: split(cellOf(row, "ipc")).length ? split(cellOf(row, "ipc")) : undefined,
			url: cellOf(row, "url") || undefined,
			source,
			seen: now(),
		});
	}
	return { patents, skipped, columns: header.filter(Boolean) };
}

export function describePatent(patent: Patent, index?: number, abstractChars = 240): string {
	const head = `${index !== undefined ? `[${index}] ` : ""}${patent.number} ${patent.title} — ${patent.applicants.slice(0, 2).join("、") || "?"}${
		patent.date ? `（公开 ${patent.date}）` : ""
	}${patent.ipc?.length ? ` IPC ${patent.ipc.slice(0, 3).join(" ")}` : ""}`;
	const abstract = patent.abstract ? `\n    ${patent.abstract.slice(0, abstractChars)}${patent.abstract.length > abstractChars ? "…" : ""}` : "";
	return head + abstract;
}
