/**
 * Exact arithmetic on the author's numbers: rates, differences, percentage points, relative change.
 * Values come from the call or straight from a CSV/TSV cell, so nothing is transcribed by hand.
 */

import { readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { slash as toPosix } from "./paths.ts";

export interface CellRef {
	file: string;
	/** Matched against the first column (trimmed, case-insensitive). */
	row: string;
	column: string;
}

export type NumberSource = number | CellRef;

export interface QuantityInput {
	name: string;
	value: NumberSource;
	/** Denominator: the quantity becomes a rate value/of in percent. */
	of?: NumberSource;
	unit?: string;
}

export interface Quantity {
	name: string;
	value: number;
	of?: number;
	/** value/of*100 when `of` is given. */
	rate?: number;
	unit?: string;
	/** "materials/results.csv: SWD / correctly_denoised" for cells; undefined for literal numbers. */
	cells: string[];
}

export interface Comparison {
	a: string;
	b: string;
	/** a - b in the unit of the compared values; percentage points when both are rates or percentages. */
	difference: number;
	differenceUnit: string;
	/** (a - b) / b * 100, undefined when b is 0. */
	relativeChange?: number;
	/** a / b, undefined when b is 0. */
	ratio?: number;
	/** For two rates: difference of the numerators (e.g. successful signals). */
	countDifference?: number;
}

function splitRow(line: string, delimiter: string): string[] {
	const cells: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quoted) {
			if (ch === '"' && line[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === delimiter) {
			cells.push(cell);
			cell = "";
		} else cell += ch;
	}
	cells.push(cell);
	return cells.map((c) => c.trim());
}

export function parseTable(text: string, delimiter: string): string[][] {
	return text
		.replace(/^﻿/, "")
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.map((line) => splitRow(line, delimiter));
}

/** Read one numeric cell. Errors name the available rows/columns so the call can be corrected. */
export function readCell(cwd: string, ref: CellRef): { value: number; label: string } {
	const path = resolve(cwd, ref.file);
	const delimiter = extname(path).toLowerCase() === ".tsv" ? "\t" : ",";
	const rows = parseTable(readFileSync(path, "utf8"), delimiter);
	const label = `${toPosix(relative(cwd, path))}: ${ref.row} / ${ref.column}`;
	if (rows.length < 2) throw new Error(`${ref.file} has no data rows.`);
	const header = rows[0];
	const col = header.findIndex((h) => h.toLowerCase() === ref.column.trim().toLowerCase());
	if (col < 0) throw new Error(`${ref.file} has no column "${ref.column}". Columns: ${header.join(", ")}.`);
	const matches = rows.slice(1).filter((r) => (r[0] ?? "").toLowerCase() === ref.row.trim().toLowerCase());
	if (matches.length !== 1) {
		const keys = rows.slice(1).map((r) => r[0]);
		throw new Error(
			`${ref.file}: ${matches.length === 0 ? "no row" : "several rows"} "${ref.row}" in the first column. Rows: ${keys.join(", ")}.`,
		);
	}
	const raw = (matches[0][col] ?? "").replace(/,/g, "").replace(/%$/, "");
	const value = Number(raw);
	if (raw === "" || !Number.isFinite(value)) throw new Error(`${label} is not a number ("${matches[0][col] ?? ""}").`);
	return { value, label };
}

function resolveNumber(cwd: string, source: NumberSource, cells: string[]): number {
	if (typeof source === "number") return source;
	const { value, label } = readCell(cwd, source);
	cells.push(label);
	return value;
}

export function resolveQuantities(cwd: string, inputs: QuantityInput[]): Quantity[] {
	const names = new Set<string>();
	return inputs.map((input) => {
		if (names.has(input.name)) throw new Error(`Quantity name "${input.name}" is used twice.`);
		names.add(input.name);
		const cells: string[] = [];
		const value = resolveNumber(cwd, input.value, cells);
		// Models with strict tool schemas fill every optional field: a typed 0 denominator means "no
		// denominator" (seen live: of=0 errored, the model retried with of=1 and plain scores became "39.9%").
		const of = input.of === undefined || input.of === 0 ? undefined : resolveNumber(cwd, input.of, cells);
		if (of === 0) throw new Error(`"${input.name}": the denominator is 0.`);
		return {
			name: input.name,
			value,
			...(of !== undefined ? { of, rate: (value / of) * 100 } : {}),
			unit: of !== undefined ? "%" : input.unit || undefined,
			cells,
		};
	});
}

/** The number a comparison works on: the rate for a rate, else the value. */
const level = (q: Quantity) => q.rate ?? q.value;

export function compare(quantities: Quantity[], a: string, b: string): Comparison {
	const qa = quantities.find((q) => q.name === a);
	const qb = quantities.find((q) => q.name === b);
	if (!qa || !qb) throw new Error(`Unknown quantity in comparison: ${!qa ? a : b}.`);
	const bothPercent = qa.unit === "%" && qb.unit === "%";
	if (!bothPercent && qa.unit !== qb.unit) {
		throw new Error(`"${a}" (${qa.unit ?? "no unit"}) and "${b}" (${qb.unit ?? "no unit"}) have different units.`);
	}
	const va = level(qa);
	const vb = level(qb);
	return {
		a,
		b,
		difference: va - vb,
		differenceUnit: bothPercent ? "percentage points" : (qa.unit ?? ""),
		...(vb !== 0 ? { relativeChange: ((va - vb) / vb) * 100, ratio: va / vb } : {}),
		...(qa.rate !== undefined && qb.rate !== undefined ? { countDifference: qa.value - qb.value } : {}),
	};
}

/** Round for display and drop trailing zeros: 80.00 -> "80", 6.6667 -> "6.67". */
export function fmt(value: number, decimals: number): string {
	const rounded = Number(value.toFixed(decimals));
	return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** Full precision kept in the ledger so any rounding the paper uses can be matched. */
export function exact(value: number): string {
	return String(Number(value.toPrecision(12)));
}

export function describeQuantity(q: Quantity, decimals: number): string {
	if (q.rate !== undefined) return `${q.name}: ${fmt(q.value, decimals)} of ${fmt(q.of ?? 0, decimals)} = ${fmt(q.rate, decimals)}%`;
	return `${q.name}: ${fmt(q.value, decimals)}${q.unit ? ` ${q.unit}` : ""}`;
}

export function describeComparison(c: Comparison, decimals: number): string {
	const sign = (v: number) => (v > 0 ? "+" : "");
	const parts = [`${c.a} vs ${c.b}: difference ${sign(c.difference)}${fmt(c.difference, decimals)} ${c.differenceUnit}`.trimEnd()];
	if (c.countDifference !== undefined) parts.push(`count difference ${sign(c.countDifference)}${fmt(c.countDifference, decimals)}`);
	if (c.relativeChange !== undefined) parts.push(`relative change ${sign(c.relativeChange)}${fmt(c.relativeChange, decimals)}%`);
	if (c.ratio !== undefined) parts.push(`ratio ${fmt(c.ratio, Math.max(decimals, 3))}`);
	return parts.join("; ");
}
