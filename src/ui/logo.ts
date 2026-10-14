import type { TerminalColorMode } from "@earendil-works/pi-tui";
import { foregroundAnsi, rgbColor } from "@earendil-works/pi-tui";

/**
 * 2pi's mark, rendered the way codex renders its logo (codex-rs/tui/src/empty_state_animation):
 * a lit 3D surface sampled into Braille dots, each cell coloured with the mean of its dots'
 * shades under fixed studio lighting (cool key light, navy shadow, steel fill, cyan rim, warm
 * highlight; one tone of the terminal's foreground on light terminals).
 *
 * The surface is an open book. Across its two pages "2π" is written in one stroke: the "2" on
 * the left page, its base running on over the gutter and rising into the "π" on the right page:
 * the paper and the patent, one piece of work. The stroke is raised and bevelled, so it is the lit
 * part, edged where the rim light catches it; the book itself is drawn in dim lines. On startup
 * the book opens from its spine.
 */

type Vec3 = [number, number, number];
type Rgb = [number, number, number];

export interface Lighting {
	background: Rgb;
	key: Rgb;
	shadow: Rgb;
	fill: Rgb;
	rim: Rgb;
	highlight: Rgb;
}

/** codex's studio lighting, adapted to the terminal's colours. */
export function logoLighting(appearance: "dark" | "light", foreground: Rgb = [36, 41, 47], background?: Rgb): Lighting {
	if (appearance === "light") {
		const bg: Rgb = background ?? [255, 255, 255];
		const mix = bg.map((value, i) => value * 0.65 + (foreground[i] ?? 0) * 0.35) as Rgb;
		return { background: bg, key: foreground, shadow: mix, fill: foreground, rim: foreground, highlight: foreground };
	}
	return {
		background: background ?? [22, 22, 26],
		key: [210, 221, 235],
		shadow: [52, 71, 105],
		fill: [76, 118, 159],
		rim: [91, 196, 216],
		highlight: [255, 244, 218],
	};
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** codex's `Lighting::shade`, unchanged: diffuse, bounce, rim edge and gloss from one key light. */
function shade(light: Lighting, [nx, ny, nz]: Vec3, depth: number, grain: number): Rgb {
	const diffuse = clamp(nx * -0.41 + ny * -0.564 + nz * 0.718 + grain);
	const bounce = clamp(nx * 0.55 + ny * 0.2 - nz * 0.35) * (1 - diffuse) * 0.38;
	const edge = (1 - Math.abs(clamp(nz, -1, 1))) ** 2.4 * clamp(nx * 0.85 - ny * 0.38) * 0.82;
	const gloss = clamp(nx * -0.22 + ny * -0.302 + nz * 0.928) ** 18 * 0.96;
	const base = (1 - bounce) * (1 - edge) * (1 - gloss);
	const gain = clamp(0.9 + depth * 0.18, 0.68, 1);
	return [0, 1, 2].map((i) => {
		const value =
			light.shadow[i]! * (1 - diffuse) * base +
			light.key[i]! * diffuse * base +
			light.fill[i]! * bounce * (1 - edge) * (1 - gloss) +
			light.rim[i]! * edge * (1 - gloss) +
			light.highlight[i]! * gloss;
		return Math.round(light.background[i]! + (value - light.background[i]!) * gain);
	}) as Rgb;
}

// ---- The stroke: "2π" written without lifting the pen, in flat page coordinates ---------------
// x runs across the open book (-1 left edge, 0 the spine, 1 right edge), y downwards.

const STROKE: [number, number][] = [
	// "2": the hook, the bowl, the diagonal down to the left, the base to the right…
	[-0.7, -0.13],
	[-0.66, -0.25],
	[-0.53, -0.31],
	[-0.38, -0.28],
	[-0.3, -0.17],
	[-0.33, -0.04],
	[-0.46, 0.1],
	[-0.6, 0.23],
	[-0.66, 0.29],
	[-0.5, 0.27],
	[-0.32, 0.27],
	// …running on low across the gutter, then up into the left leg of "π"…
	[-0.14, 0.29],
	[0.06, 0.3],
	[0.2, 0.28],
	[0.27, 0.2],
	[0.29, 0.06],
	[0.29, -0.08],
	[0.28, -0.2],
	// …along the bar, turning at its end down into the right leg, which flicks out.
	[0.3, -0.27],
	[0.46, -0.29],
	[0.66, -0.28],
	[0.78, -0.26],
	[0.74, -0.2],
	[0.67, -0.12],
	[0.65, 0.02],
	[0.66, 0.16],
	[0.71, 0.26],
	[0.8, 0.27],
	[0.86, 0.22],
];

/** Catmull-Rom through the points: a smooth pen path as short segments. */
function penPath(points: [number, number][], steps = 14): [number, number][] {
	const path: [number, number][] = [];
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[Math.max(0, i - 1)]!;
		const p1 = points[i]!;
		const p2 = points[i + 1]!;
		const p3 = points[Math.min(points.length - 1, i + 2)]!;
		for (let step = 0; step < steps; step++) {
			const t = step / steps;
			const t2 = t * t;
			const t3 = t2 * t;
			const at = (k: 0 | 1) =>
				0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
			path.push([at(0), at(1)]);
		}
	}
	path.push(points.at(-1)!);
	return path;
}

interface Segment {
	ax: number;
	ay: number;
	dx: number;
	dy: number;
	length2: number;
	half: number;
}

// A broad nib held at an angle: downstrokes are thick, horizontal strokes and joins thin.
const NIB = (25 * Math.PI) / 180;
const THIN = 0.03;
const THICK = 0.068;
/** The stroke stands this far off the page; its edges are rounded over this width. */
const RAISE = 0.03;
const BEVEL = 0.035;

const SEGMENTS: Segment[] = (() => {
	const path = penPath(STROKE);
	const segments: Segment[] = [];
	for (let i = 0; i < path.length - 1; i++) {
		const [ax, ay] = path[i]!;
		const [bx, by] = path[i + 1]!;
		const dx = bx - ax;
		const dy = by - ay;
		const angle = Math.atan2(dy, dx);
		segments.push({ ax, ay, dx, dy, length2: dx * dx + dy * dy || 1e-9, half: THIN + (THICK - THIN) * Math.abs(Math.sin(angle - NIB)) });
	}
	return segments;
})();

/** Signed distance to the stroke (negative inside) and the direction away from it. */
function stroke(x: number, y: number): { distance: number; gx: number; gy: number } {
	let best = Number.POSITIVE_INFINITY;
	let gx = 0;
	let gy = 0;
	for (const s of SEGMENTS) {
		const t = clamp(((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.length2);
		const px = x - (s.ax + s.dx * t);
		const py = y - (s.ay + s.dy * t);
		const length = Math.hypot(px, py);
		const distance = length - s.half;
		if (distance < best) {
			best = distance;
			gx = length > 0 ? px / length : 0;
			gy = length > 0 ? py / length : 0;
		}
	}
	return { distance: best, gx, gy };
}

// ---- The book ------------------------------------------------------------------------------------

const PAGE = 0.96;
/** Top and bottom edges of a page at distance u from the spine: both dip into the gutter. */
const top = (u: number) => -0.54 + 0.13 * (1 - u / PAGE) ** 2;
const bottom = (u: number) => 0.36 + 0.15 * (1 - u / PAGE) ** 2;
/** Each page curls up from the spine and falls away again towards its edge. */
const CURL = 0.26;
const lift = (u: number) => CURL * Math.sin((Math.PI * Math.min(u, PAGE)) / PAGE) ** 0.8;
const liftSlope = (u: number) => {
	const a = (Math.PI * Math.min(u, PAGE)) / PAGE;
	const sinA = Math.max(1e-3, Math.sin(a));
	return CURL * 0.8 * sinA ** -0.2 * Math.cos(a) * (Math.PI / PAGE);
};

export interface LogoCell {
	/** Braille dot bits (0 for an empty cell). */
	dots: number;
	rgb: Rgb;
}

const DOT_BITS = [1, 8, 2, 16, 4, 32, 64, 128];
/** The logo's extent in book units; the dot grid keeps dots square. */
const SPAN_X = 2.16;
const SPAN_Y = 1.36;
const CENTER_Y = 0.04;

/** Rows for a logo `columns` wide, keeping the book's proportions (Braille dots are square). */
export function logoRows(columns: number): number {
	return Math.max(3, Math.round((columns * 2 * SPAN_Y) / SPAN_X / 4));
}

function smooth(value: number): number {
	const t = clamp(value);
	return t * t * t * (t * (t * 6 - 15) + 10);
}

interface Sample {
	side: 1 | -1;
	u: number;
	y: number;
	/** Height above the page plane. */
	w: number;
	/** Normal in page coordinates (u away from the spine, y down, w up off the page). */
	normal: Vec3;
	material: "ink" | "line";
	grain: number;
}

const surfaces = new Map<number, Sample[]>();

/**
 * Points on the book's surface, every half dot at this scale: the raised stroke and the outline.
 * They do not depend on how far the book is open, so they are computed once per size.
 */
function surface(scale: number): Sample[] {
	const key = Math.round(scale * 100);
	const cached = surfaces.get(key);
	if (cached) return cached;
	const samples: Sample[] = [];
	const step = 0.5 / scale;
	const pageNormalAt = (u: number): Vec3 => {
		const slope = liftSlope(u);
		const length = Math.hypot(slope, 1);
		return [-slope / length, 0, 1 / length];
	};
	const line = (side: 1 | -1, u: number, y: number, w: number, normal: Vec3) =>
		samples.push({ side, u, y, w, normal, material: "line", grain: 0 });
	for (const side of [-1, 1] as const) {
		// The stroke: a raised, bevelled ribbon on the page, so its edges catch the rim light.
		for (let u = 0; u <= PAGE; u += step) {
			const page = pageNormalAt(u);
			for (let y = top(u); y <= bottom(u); y += step) {
				const ink = stroke(side * u, y);
				if (ink.distance >= 0) continue;
				const edge = clamp(1 - -ink.distance / BEVEL);
				const nz = Math.sqrt(1 - edge * edge);
				const normal: Vec3 = [page[0] + side * ink.gx * edge, ink.gy * edge, page[2] * nz];
				const length = Math.hypot(...normal);
				samples.push({
					side,
					u,
					y,
					w: lift(u) + RAISE * nz,
					normal: [normal[0] / length, normal[1] / length, normal[2] / length],
					material: "ink",
					grain: Math.sin(u * 23 + y * 19 + 3.9) * 0.01,
				});
			}
		}
		// The book in outline: the curved top edge, the bottom edge and two lines of leaves under it,
		// the outer edge.
		for (let u = 0; u <= PAGE; u += step / 2) {
			const page = pageNormalAt(u);
			line(side, u, top(u), lift(u), [page[0], -0.45, page[2]]);
			line(side, u, bottom(u), lift(u), [page[0], 0.3, page[2]]);
			for (const [offset, sink] of [
				[0.05, 0.75],
				[0.1, 0.5],
			] as const) {
				if (u < PAGE - offset * 0.6) line(side, u, bottom(u) + offset, lift(u) * sink, [page[0], 0.55, page[2]]);
			}
		}
		for (let y = top(PAGE); y <= bottom(PAGE); y += step / 2) line(side, PAGE, y, lift(PAGE), [0.6, 0, 0.8]);
	}
	// The spine.
	for (let y = top(0); y <= bottom(0) + 0.1; y += step / 2) line(1, 0, y, 0, [0, 0.2, 0.98]);
	surfaces.set(key, samples);
	return samples;
}

/**
 * The logo as cells. `opening` runs from 0 (the book closed, pages standing on the spine) to 1
 * (open, the resting pose).
 */
export function renderLogo(columns: number, rows: number, light: Lighting, opening = 1): LogoCell[][] {
	const dotColumns = columns * 2;
	const dotRows = rows * 4;
	const scale = Math.min(dotColumns / SPAN_X, dotRows / SPAN_Y);
	const depth = new Float32Array(dotColumns * dotRows).fill(Number.NEGATIVE_INFINITY);
	const colors: Rgb[] = new Array(dotColumns * dotRows);
	// While opening, each page swings down about the spine from upright.
	const angle = (1 - smooth(opening)) * (Math.PI / 2) * 0.94;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	for (const { side, u, y, w, normal, material, grain } of surface(scale)) {
		// Rotate about the spine (the y axis): the page's u axis swings from the viewer to the side.
		const x = side * (u * cos - w * sin);
		const z = u * sin + w * cos;
		const nx = side * (normal[0] * cos - normal[2] * sin);
		const nz = normal[0] * sin + normal[2] * cos;
		const perspective = 4.4 / (4.4 - z);
		const column = Math.floor(dotColumns / 2 + x * perspective * scale);
		const row = Math.floor(dotRows / 2 + (y - CENTER_Y) * perspective * scale);
		if (column < 0 || column >= dotColumns || row < 0 || row >= dotRows) continue;
		const index = row * dotColumns + column;
		if (z <= depth[index]!) continue;
		depth[index] = z;
		const rgb = shade(light, [nx, normal[1], nz], z, grain);
		// The book is drawn in fine lines that recede; the stroke is the lit, raised part.
		colors[index] =
			material === "line"
				? (rgb.map((value, i) => Math.round(value * 0.38 + light.fill[i]! * 0.22 + light.background[i]! * 0.4)) as Rgb)
				: rgb;
	}

	const cells: LogoCell[][] = [];
	for (let row = 0; row < rows; row++) {
		const line: LogoCell[] = [];
		for (let column = 0; column < columns; column++) {
			let dots = 0;
			let count = 0;
			const sum: Rgb = [0, 0, 0];
			DOT_BITS.forEach((bit, point) => {
				const index = (row * 4 + Math.floor(point / 2)) * dotColumns + column * 2 + (point % 2);
				const rgb = colors[index];
				if (Number.isFinite(depth[index]!) && rgb) {
					dots |= bit;
					count += 1;
					for (let i = 0; i < 3; i++) sum[i]! += rgb[i]!;
				}
			});
			line.push({ dots, rgb: count ? (sum.map((value) => Math.round(value / count)) as Rgb) : [0, 0, 0] });
		}
		cells.push(line);
	}
	return cells;
}

/** Cells to terminal lines; without a colour mode the dots are left uncoloured. */
export function logoLines(cells: LogoCell[][], mode: TerminalColorMode | undefined): string[] {
	return cells.map((line) =>
		line
			.map((cell) => {
				if (!cell.dots) return " ";
				const ch = String.fromCodePoint(0x2800 + cell.dots);
				return mode ? `${foregroundAnsi(rgbColor(...cell.rgb), mode)}${ch}\x1b[39m` : ch;
			})
			.join(""),
	);
}
