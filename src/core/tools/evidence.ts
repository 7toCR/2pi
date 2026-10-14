import { relative } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
	addEntries,
	EVIDENCE_CLASSES,
	formatEntry,
	ledgerSummary,
	loadLedger,
	removeEntries,
	saveLedger,
	updateEntry,
} from "../evidence.ts";
import { slash as toPosix } from "../paths.ts";
import { ledgerPath as ledgerPathFor } from "../project.ts";

const EvidenceClass = Type.Union(
	EVIDENCE_CLASSES.map((c) => Type.Literal(c)),
	{
		description:
			"verified: you read material that supports it; author-reported: stated by the author, not checked; interpretation: a hypothesis (hedge it in the paper); missing: missing or conflicting (write a [MISSING: ...] marker; its numbers never count as traced)",
	},
);

const EntryFields = {
	claim: Type.String({ description: "The fact as it will be used, with its numbers, e.g. 'SWD met the 20 dB criterion for 160 of 200 test signals'" }),
	class: EvidenceClass,
	source: Type.String({ description: "File and location (table/row/column, page, section), citation key, or 'computed'" }),
	numbers: Type.Optional(
		Type.Array(Type.Union([Type.String(), Type.Number()]), {
			description: "Numbers this entry vouches for; default: every number in the claim",
		}),
	),
	derivedFrom: Type.Optional(Type.Array(Type.String(), { description: "Entry ids a computed value comes from" })),
	formula: Type.Optional(Type.String()),
	note: Type.Optional(Type.String({ description: "Conflicts, caveats or what to verify" })),
};

export const evidenceTool = defineTool({
	name: "evidence",
	label: "Evidence ledger",
	description:
		"The project's evidence ledger (notes/evidence.json, or 证据账本 in 2PI.md), shared by the paper and the patent: one entry per fact or number the drafts rest on, with its class and source. The paper checker compares every salient number in the manuscript with the ledger (V01 = a number nobody recorded); a patent drafted in the same project uses the entries as its source facts. Actions: add (entries, several per call), update (id + changed fields), remove (ids), list (optional query/class filter).",
	promptSnippet: "Record, update and list the evidence (claim, class, source) behind the facts and numbers of the paper and patent",
	promptGuidelines: [
		"Before writing a fact or number into a manuscript, record it with evidence (class and source), several entries per call; record conflicting or absent values with class 'missing' and use the domain's gap marker. Derived numbers come from compute_stats, which records them.",
	],
	executionMode: "sequential",
	parameters: Type.Object({
		action: Type.Union([Type.Literal("add"), Type.Literal("update"), Type.Literal("remove"), Type.Literal("list")]),
		entries: Type.Optional(Type.Array(Type.Object(EntryFields), { description: "For add" })),
		id: Type.Optional(Type.String({ description: "For update" })),
		changes: Type.Optional(Type.Partial(Type.Object(EntryFields), { description: "For update" })),
		ids: Type.Optional(Type.Array(Type.String(), { description: "For remove" })),
		query: Type.Optional(Type.String({ description: "For list: text that the claim, source or note contains" })),
		class: Type.Optional(EvidenceClass),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const path = ledgerPathFor(ctx.cwd);
		const ledger = loadLedger(path);
		const where = toPosix(relative(ctx.cwd, path)) || path;
		let text: string;
		if (params.action === "add") {
			if (!params.entries?.length) throw new Error("add needs entries.");
			const added = addEntries(ledger, params.entries);
			saveLedger(path, ledger);
			text = `Added to ${where}:\n${added.map(formatEntry).join("\n")}`;
		} else if (params.action === "update") {
			if (!params.id || !params.changes) throw new Error("update needs id and changes.");
			const entry = updateEntry(ledger, params.id, params.changes);
			saveLedger(path, ledger);
			text = `Updated: ${formatEntry(entry)}`;
		} else if (params.action === "remove") {
			if (!params.ids?.length) throw new Error("remove needs ids.");
			removeEntries(ledger, params.ids);
			saveLedger(path, ledger);
			text = `Removed ${params.ids.join(", ")}.`;
		} else {
			const q = params.query?.toLowerCase();
			const rows = ledger.entries.filter(
				(e) =>
					(!params.class || e.class === params.class) &&
					(!q || `${e.claim} ${e.source} ${e.note ?? ""}`.toLowerCase().includes(q)),
			);
			text = rows.length ? rows.map(formatEntry).join("\n") : "No matching entries.";
		}
		return {
			content: [{ type: "text", text: `${text}\nLedger ${where}: ${ledgerSummary(ledger)}.` }],
			details: { path, count: ledger.entries.length },
		};
	},
});
