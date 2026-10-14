import { relative } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { addEntries, type EvidenceClass, formatEntry, loadLedger, type NewEntry, saveLedger } from "../evidence.ts";
import { slash as toPosix } from "../paths.ts";
import { compare, describeComparison, describeQuantity, exact, resolveQuantities } from "../stats.ts";
import { ledgerPath as ledgerPathFor } from "../project.ts";

const Cell = Type.Object(
	{
		file: Type.String({ description: "CSV or TSV file, e.g. materials/results.csv" }),
		row: Type.String({ description: "Value in the first column that identifies the row" }),
		column: Type.String({ description: "Header of the column" }),
	},
	{ description: "Read the number from a table cell instead of typing it" },
);
const NumberOrCell = Type.Union([Type.Number(), Cell]);

export const computeStatsTool = defineTool({
	name: "compute_stats",
	label: "Compute statistics",
	description:
		"Exact arithmetic on the author's numbers: rates (value of a total, in %), differences, percentage points, relative change and ratios. Numbers can be read straight from CSV/TSV cells. Results are recorded in the evidence ledger with their sources and the entries they derive from, so the checker can trace every number. It does not run significance tests: without per-item data there is no test to report.",
	promptSnippet: "Compute rates, differences, percentage points and relative change exactly, reading CSV cells directly",
	promptGuidelines: [
		"Use compute_stats for every derived number (rates, differences, relative change) before writing it; never compute in your head. Between two percentages, the absolute difference is in percentage points; the relative change is a separate number.",
	],
	executionMode: "sequential",
	parameters: Type.Object({
		quantities: Type.Array(
			Type.Object({
				name: Type.String({ description: "Short label, e.g. 'SWD success'" }),
				value: NumberOrCell,
				of: Type.Optional(
					Type.Union([Type.Number(), Cell], {
						description: "Denominator, only for a rate (value of a total, in %). Omit it, or give 0, for scores, means and other plain values",
					}),
				),
				unit: Type.Optional(Type.String({ description: "Unit of a plain value, e.g. dB, ms" })),
				source: Type.Optional(Type.String({ description: "Where a typed number comes from (required to record it)" })),
				class: Type.Optional(
					Type.Union([Type.Literal("verified"), Type.Literal("author-reported")], {
						description: "Evidence class of a typed number; cell values are 'verified'",
					}),
				),
			}),
			{ minItems: 1 },
		),
		compare: Type.Optional(
			Type.Array(Type.Object({ a: Type.String(), b: Type.String() }), {
				description: "Pairs of quantity names; a is compared with b (a - b, (a - b)/b)",
			}),
		),
		decimals: Type.Optional(Type.Integer({ minimum: 0, maximum: 6, description: "Decimals shown; default 2" })),
		record: Type.Optional(Type.Boolean({ description: "Record inputs and results in the evidence ledger; default true" })),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const decimals = params.decimals ?? 2;
		const quantities = resolveQuantities(ctx.cwd, params.quantities);
		const comparisons = (params.compare ?? []).map((pair) => compare(quantities, pair.a, pair.b));
		const lines = [
			...quantities.map((q) => `${describeQuantity(q, decimals)}${q.cells.length ? `  [${q.cells.join("; ")}]` : ""}`),
			...comparisons.map((c) => describeComparison(c, decimals)),
		];

		if (params.record ?? true) {
			const path = ledgerPathFor(ctx.cwd);
			const ledger = loadLedger(path);
			const ids = new Map<string, string>();
			const inputs: NewEntry[] = quantities.map((q, i) => {
				const input = params.quantities[i];
				const source = q.cells.join("; ") || input.source?.trim();
				if (!source) throw new Error(`"${q.name}" is a typed number: give its source to record it, or set record=false.`);
				const cls: EvidenceClass = q.cells.length ? "verified" : (input.class ?? "author-reported");
				const numbers = [q.value, q.of, q.rate].filter((n): n is number => n !== undefined).map(exact);
				return { claim: describeQuantity(q, decimals), class: cls, source, numbers };
			});
			const addedInputs = addEntries(ledger, inputs);
			quantities.forEach((q, i) => ids.set(q.name, addedInputs[i].id));
			const derived: NewEntry[] = comparisons.map((c) => ({
				claim: describeComparison(c, decimals),
				class: "verified",
				source: "computed (compute_stats)",
				derivedFrom: [ids.get(c.a) ?? "", ids.get(c.b) ?? ""],
				formula: "a - b; (a - b) / b * 100; a / b",
				// The paper states magnitudes ("a decrease of 6.67%"), so record absolute values.
				numbers: [c.difference, c.relativeChange, c.ratio, c.countDifference]
					.filter((n): n is number => n !== undefined)
					.map((n) => exact(Math.abs(n))),
			}));
			const addedDerived = addEntries(ledger, derived);
			saveLedger(path, ledger);
			lines.push(
				"",
				`Recorded in ${toPosix(relative(ctx.cwd, path)) || path}:`,
				...[...addedInputs, ...addedDerived].map(formatEntry),
			);
		}
		lines.push(
			"",
			"Wording: the absolute difference between two percentages is in percentage points; give the relative change separately if needed. No significance test was run: do not write 'significant'.",
		);
		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: { quantities, comparisons },
		};
	},
});
