#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { defaultPacks } = await import("../dist/extension.js");
const required = [
	"bin/2pi.mjs",
	"dist/cli.js",
	"python/ingest_paper.py",
	"python/redline_docx.py",
	"python/requirements.txt",
	"templates/2PI.md",
	"templates/paper/memo.md",
	"templates/paper/latex/common/sections/methods.tex",
	"skills/SOURCES.json",
	"skills/research/SKILL.md",
	"skills/research2paper/SKILL.md",
	"skills/research2paper/LICENSE",
	"skills/paper2patent/SKILL.md",
	"skills/research2paper/scripts/check_paper_draft.py",
	"skills/research2paper/scripts/fill_gaps.py",
	"skills/paper2patent/LICENSE",
	"skills/paper2patent/assets/example_patent_content.json",
	...[
		"patent_common.py", "check_patent_draft.py", "generate_patent_drawings.py",
		"generate_patent_docx.py", "export_patent_pdf.py",
	].map((name) => `skills/paper2patent/scripts/${name}`),
	...["article", "elsarticle", "ieeetran"].map((name) => `templates/paper/latex/${name}/main.tex`),
];
for (const path of required) accessSync(join(root, path), constants.R_OK);
const packs = defaultPacks();
console.error(`Package resources verified: ${packs.map((pack) => pack.id).join(", ")}.`);
