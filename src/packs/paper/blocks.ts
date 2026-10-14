import type { Block } from "../../core/blocks.ts";

const SECTION = /\\(section|subsection|subsubsection|paragraph)\*?\{([^}]*)\}/;

/**
 * LaTeX paragraphs (blank-line separated), titled by the nearest sectioning command above them:
 * "Methods 第3段" (or "methods.tex 第3段" before any heading). Comment-only paragraphs are skipped.
 */
export function latexBlocks(path: string, content: string): Block[] | undefined {
	if (!path.toLowerCase().endsWith(".tex")) return undefined;
	const file = path.replace(/\\/g, "/").split("/").pop() ?? path;
	const blocks: Block[] = [];
	let heading = "";
	let count = 0;
	for (const paragraph of content.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
		const text = paragraph.trim();
		if (!text || text.split("\n").every((line) => line.trim().startsWith("%"))) continue;
		const section = SECTION.exec(text);
		if (section) {
			heading = (section[2] ?? "").trim();
			count = 0;
		}
		count += 1;
		blocks.push({ id: `p${blocks.length + 1}`, title: `${heading || file} 第${count}段`, text });
	}
	return blocks;
}
