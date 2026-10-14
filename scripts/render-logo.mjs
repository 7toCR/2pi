#!/usr/bin/env node
// Draws 2pi's startup mark (src/ui/logo.ts) as SVG for the README: one round dot per Braille dot,
// coloured like the terminal cell it sits in. The dark file uses codex's lighting, the light file
// the one-tone fallback, each blended against GitHub's page colour.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logoLighting, logoRows, renderLogo } from "../src/ui/logo.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const COLUMNS = 34;
/** Braille dots sit on a square grid: a cell is two dots wide and four tall, twice as tall as wide. */
const PITCH = 6;
const DOT = 4.2;
const MARGIN = 6;
/** Dot order in logo.ts: left then right, top to bottom. */
const DOT_BITS = [1, 8, 2, 16, 4, 32, 64, 128];

const hex = (rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

function svg(light) {
	const cells = renderLogo(COLUMNS, logoRows(COLUMNS), light);
	// Dots of one colour become one path of zero-length round-capped segments.
	const paths = new Map();
	cells.forEach((line, row) =>
		line.forEach((cell, column) => {
			DOT_BITS.forEach((bit, point) => {
				if (!(cell.dots & bit)) return;
				const x = MARGIN + (column * 2 + (point % 2)) * PITCH + PITCH / 2;
				const y = MARGIN + (row * 4 + Math.floor(point / 2)) * PITCH + PITCH / 2;
				const colour = hex(cell.rgb);
				paths.set(colour, `${paths.get(colour) ?? ""}M${x} ${y}h0`);
			});
		}),
	);
	const width = MARGIN * 2 + COLUMNS * 2 * PITCH;
	const height = MARGIN * 2 + cells.length * 4 * PITCH;
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
		"<title>2pi</title>",
		`<g fill="none" stroke-width="${DOT}" stroke-linecap="round">`,
		...[...paths].map(([colour, d]) => `<path stroke="${colour}" d="${d}"/>`),
		"</g>",
		"</svg>",
		"",
	].join("\n");
}

const out = join(root, "docs");
mkdirSync(out, { recursive: true });
// GitHub's page colours: #0d1117 behind dark text, #ffffff and #1f2328 for light.
writeFileSync(join(out, "logo-dark.svg"), svg(logoLighting("dark", undefined, [13, 17, 23])));
writeFileSync(join(out, "logo-light.svg"), svg(logoLighting("light", [31, 35, 40], [255, 255, 255])));
console.log("docs/logo-dark.svg, docs/logo-light.svg");
