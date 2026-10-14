import type { Block } from "../../core/blocks.ts";

const SECTION_TITLES: Record<string, string> = {
	technical_field: "技术领域",
	background: "背景技术",
	invention_content: "发明内容",
	drawing_description: "附图说明",
	embodiments: "具体实施方式",
};

export function isPatentData(data: unknown): data is Record<string, unknown> {
	return !!data && typeof data === "object" && !Array.isArray(data) && ("claims" in data || "invention_name" in data);
}

/** A description item: a paragraph, a {formula, label} or a {table, caption}. */
function itemText(item: unknown): string {
	if (typeof item === "string") return item;
	if (item && typeof item === "object") {
		const record = item as Record<string, unknown>;
		if (typeof record.formula === "string") return `公式${record.label ? ` ${String(record.label)}` : ""}：${record.formula}`;
		if (Array.isArray(record.table)) {
			const rows = (record.table as unknown[]).map((row) => (Array.isArray(row) ? row.map(String).join(" | ") : String(row)));
			return [record.caption ? `表：${String(record.caption)}` : "表", ...rows].join("\n");
		}
	}
	return JSON.stringify(item);
}

function drawingText(drawing: Record<string, unknown>): string {
	const nodes = Array.isArray(drawing.nodes)
		? (drawing.nodes as Array<Record<string, unknown>>).map((node) => String(node.label ?? node.id ?? "")).join("；")
		: "";
	const edges = Array.isArray(drawing.edges)
		? (drawing.edges as unknown[]).map((edge) => (Array.isArray(edge) ? `${edge[0]}→${edge[1]}` : JSON.stringify(edge))).join("，")
		: "";
	return [String(drawing.title ?? ""), nodes && `节点：${nodes}`, edges && `连线：${edges}`].filter(Boolean).join("\n");
}

/**
 * A patent JSON in application order: name, abstract, each claim, each description paragraph,
 * each drawing, then the drafting notes (support map, gaps, notes), which are not part of the
 * application text but are reviewed with it. Generated `drawing_assets` are left out.
 */
export function patentBlocks(path: string, content: string): Block[] | undefined {
	if (!path.toLowerCase().endsWith(".json")) return undefined;
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch {
		return undefined;
	}
	if (!isPatentData(data)) return undefined;
	const blocks: Block[] = [];
	const add = (id: string, title: string, text: unknown) => {
		if (text === undefined || text === null || text === "") return;
		blocks.push({ id, title, text: typeof text === "string" ? text : JSON.stringify(text, null, 1) });
	};
	add("name", "发明名称", data.invention_name);
	add("abstract", "说明书摘要", data.abstract);
	(Array.isArray(data.claims) ? data.claims : []).forEach((claim, i) => add(`claims/${i + 1}`, `权利要求${i + 1}`, claim));
	const description = (data.description ?? {}) as Record<string, unknown>;
	for (const [key, value] of Object.entries(description)) {
		const section = SECTION_TITLES[key] ?? key;
		const items = Array.isArray(value) ? value : [value];
		items.forEach((item, i) => add(`description/${key}/${i + 1}`, `说明书·${section} 第${i + 1}段`, itemText(item)));
	}
	(Array.isArray(data.drawings) ? data.drawings : []).forEach((drawing, i) => {
		const record = (drawing ?? {}) as Record<string, unknown>;
		const no = record.figure_no ?? i + 1;
		add(`drawings/${no}`, `图${no}`, drawingText(record));
	});
	const supportMap = (data.support_map ?? {}) as Record<string, unknown>;
	for (const [claim, sources] of Object.entries(supportMap)) {
		add(`support_map/${claim}`, `支持关系·权利要求${claim}`, Array.isArray(sources) ? sources.map(String).join("\n") : sources);
	}
	(Array.isArray(data.gaps) ? data.gaps : []).forEach((gap, i) => add(`gaps/${i + 1}`, `缺口 ${i + 1}`, gap));
	for (const [key, value] of Object.entries((data.notes ?? {}) as Record<string, unknown>)) add(`notes/${key}`, `撰写说明·${key}`, value);
	return blocks;
}

/** Which part of the application a block id belongs to, for documents that group blocks. */
export function patentPart(id: string): "abstract" | "claims" | "description" | "drawings" | "notes" {
	if (id === "abstract") return "abstract";
	if (id.startsWith("claims/")) return "claims";
	if (id === "name" || id.startsWith("description/")) return "description";
	if (id.startsWith("drawings/")) return "drawings";
	return "notes";
}
