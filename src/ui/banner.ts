import type { TerminalColorMode } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { logoLighting, logoLines, logoRows, renderLogo } from "./logo.ts";

/**
 * The startup header: the mark (an open book with "2π" written across its pages in one stroke,
 * see logo.ts), and beside it, as in codex's header, the name and version in bold, then the
 * model and the directory in a quiet colour. Below, a line of common commands.
 */

export interface BannerInfo {
	version: string;
	/** "provider/model · thinking", or a hint to sign in when there is no model. */
	model: string;
	/** The working directory, shortened. */
	directory: string;
	domains: string;
	/** Key hints, already styled by the caller. */
	hints: string;
}

export interface BannerStyle {
	/** Terminal colour mode for the mark; undefined draws it without colour. */
	mode: TerminalColorMode | undefined;
	appearance: "dark" | "light";
	/** The theme's text colour; light terminals draw the mark in it, as codex does. */
	foreground?: [number, number, number];
	bold(text: string): string;
	dim(text: string): string;
}

export const LOGO_COLUMNS = 34;
const GAP = 3;
/** Narrower than this, the text goes under the mark; narrower still, the mark is left out. */
const SIDE_BY_SIDE = 1 + LOGO_COLUMNS + GAP + 30;
const WITH_LOGO = LOGO_COLUMNS + 2;

/**
 * Header lines for `width` columns. `opening` (0–1) draws the book partly open, for the startup
 * animation; 1 is the resting pose.
 */
export function bannerLines(width: number, info: BannerInfo, style: BannerStyle, opening = 1): string[] {
	const text = [
		`${style.bold("2pi")} ${style.dim(`v${info.version}`)}`,
		style.dim(info.model),
		style.dim(`${info.directory}${info.domains ? ` · 领域 ${info.domains}` : ""}`),
	];
	const lines: string[] = [""];
	if (width < WITH_LOGO) {
		lines.push(...text.map((line) => ` ${line}`));
	} else {
		const rows = logoRows(LOGO_COLUMNS);
		const light = logoLighting(style.appearance, style.foreground);
		const logo = logoLines(renderLogo(LOGO_COLUMNS, rows, light, opening), style.mode);
		if (width >= SIDE_BY_SIDE) {
			const first = Math.floor((rows - text.length) / 2);
			logo.forEach((row, index) => {
				const beside = text[index - first];
				lines.push(beside ? ` ${row}${" ".repeat(Math.max(GAP, LOGO_COLUMNS + GAP - visibleWidth(row)))}${beside}` : ` ${row}`);
			});
		} else {
			lines.push(...logo.map((row) => ` ${row}`), "", ...text.map((line) => ` ${line}`));
		}
	}
	lines.push("", ` ${info.hints}`);
	return lines.map((line) => truncateToWidth(line.replace(/\s+$/, ""), width, "…"));
}
