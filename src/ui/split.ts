import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	matchesKey,
	type OverlayHandle,
	ScrollView,
	type StackEntry,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	VStack,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { type FlowModel, type FlowView, VIEW_KEY } from "./flow.ts";

/**
 * The split view: pi's transcript on the left, the flow panel on the right (as narrow as it goes
 * until the divider is first dragged), a divider between them that can be dragged with the mouse,
 * and pi's input dock across the bottom.
 *
 * pi builds its fullscreen layout itself (a VStack of the transcript ScrollView and the dock);
 * extensions get no hook into it, so 2pi wraps the layout root the renderer was given. The
 * components stay pi's own: the transcript keeps scrolling, following output and searching as
 * before. If pi replaces the root (switching TUI mode in /settings), the wrap is applied again on
 * the next frame tick. Regular (main-screen) mode keeps pi's single column.
 */

export interface SplitPrefs {
	/** Whether the panel is shown (default true). */
	enabled: boolean;
	/** Share of the width the transcript gets (default: the most it can have, the divider at the right). */
	ratio: number;
	/** What the panel shows: the track of steps (default) or the tree the run grew. */
	view: FlowView;
}

const MAX_RATIO = 0.85;
export const DEFAULT_PREFS: SplitPrefs = { enabled: true, ratio: MAX_RATIO, view: "track" };
const PREFS_FILE = "2pi.json";
/** Narrower terminals keep one column: the panel would squeeze the transcript too much. */
export const MIN_SPLIT_WIDTH = 90;
const MIN_LEFT = 44;
const MIN_RIGHT = 28;

export function clampRatio(ratio: number, width: number): number {
	const low = Math.max(0.35, MIN_LEFT / Math.max(1, width));
	const high = Math.min(MAX_RATIO, 1 - MIN_RIGHT / Math.max(1, width));
	if (low > high) return DEFAULT_PREFS.ratio;
	return Math.min(high, Math.max(low, Number.isFinite(ratio) ? ratio : DEFAULT_PREFS.ratio));
}

/** Preferences live in 2pi's own file in the agent directory, never in pi's settings.json. */
export function readPrefs(agentDir: string): SplitPrefs {
	try {
		const path = join(agentDir, PREFS_FILE);
		if (!existsSync(path)) return { ...DEFAULT_PREFS };
		const data = JSON.parse(readFileSync(path, "utf8")) as Partial<{ splitView: unknown; splitRatio: unknown; flowView: unknown }>;
		return {
			enabled: typeof data.splitView === "boolean" ? data.splitView : DEFAULT_PREFS.enabled,
			ratio: typeof data.splitRatio === "number" && data.splitRatio > 0 && data.splitRatio < 1 ? data.splitRatio : DEFAULT_PREFS.ratio,
			view: data.flowView === "tree" ? "tree" : DEFAULT_PREFS.view,
		};
	} catch {
		return { ...DEFAULT_PREFS };
	}
}

export function writePrefs(agentDir: string, prefs: SplitPrefs): void {
	try {
		const path = join(agentDir, PREFS_FILE);
		let data: Record<string, unknown> = {};
		if (existsSync(path)) data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		data.splitView = prefs.enabled;
		data.splitRatio = Math.round(prefs.ratio * 1000) / 1000;
		data.flowView = prefs.view;
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	} catch {
		// A preference that cannot be saved only costs the user one more drag.
	}
}

/** The one-column divider. Drag it to resize; it lights up while dragged. */
export class Splitter implements Component {
	dragging = false;
	private readonly rows: () => number;
	private readonly theme: () => Theme;
	private readonly onDrag: (screenX: number) => void;
	private readonly onRelease: () => void;

	constructor(options: { rows: () => number; theme: () => Theme; onDrag: (screenX: number) => void; onRelease: () => void }) {
		this.rows = options.rows;
		this.theme = options.theme;
		this.onDrag = options.onDrag;
		this.onRelease = options.onRelease;
	}

	render(_width: number): string[] {
		const theme = this.theme();
		const rows = Math.max(1, this.rows());
		const middle = Math.floor(rows / 2) - 2;
		// A grip in the middle shows the divider can be moved.
		return Array.from({ length: rows }, (_, row) => {
			const grip = Math.abs(row - middle) <= 1;
			if (this.dragging) return theme.fg("accent", "┃");
			return grip ? theme.fg("muted", "┃") : theme.fg("borderMuted", "│");
		});
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left" && event.type !== "release" && event.type !== "move") return undefined;
		if (event.type === "press") {
			this.dragging = true;
			return { capture: true, render: true };
		}
		if (event.type === "drag" && this.dragging) {
			this.onDrag(event.screenX);
			return { handled: true, render: true };
		}
		if (event.type === "release" && this.dragging) {
			this.dragging = false;
			this.onRelease();
			return { handled: true, render: true };
		}
		return event.type === "click" ? { handled: true } : undefined;
	}

	invalidate(): void {}
}

/** The flow panel: one column of padding, then the flow model's lines. Clicking a step opens it. */
export class FlowPanel implements Component {
	frame = 0;
	private readonly flow: FlowModel;
	private readonly theme: () => Theme;
	private readonly onSelect: (key: string) => void;

	constructor(flow: FlowModel, theme: () => Theme, onSelect: (key: string) => void) {
		this.flow = flow;
		this.theme = theme;
		this.onSelect = onSelect;
	}

	render(width: number): string[] {
		const theme = this.theme();
		if (width < 4) return [];
		return ["", ...this.flow.render(width - 2, this.frame, theme).map((line) => ` ${line}`)];
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left") return undefined;
		// Line 0 is the blank top padding, column 0 the left one.
		const key = this.flow.keyAt(event.y - 1, event.x - 1);
		if (!key) return undefined;
		this.onSelect(key);
		return { handled: true };
	}

	invalidate(): void {}
}

/** A node's history in a bordered overlay; Esc, q or Enter closes it, ↑↓ scroll. */
export class DetailView implements Component {
	private offset = 0;
	private readonly title: string;
	private readonly lines: string[];
	private readonly theme: Theme;
	private readonly maxRows: () => number;
	private readonly close: () => void;

	constructor(options: { title: string; lines: string[]; theme: Theme; maxRows: () => number; close: () => void }) {
		this.title = options.title;
		this.lines = options.lines;
		this.theme = options.theme;
		this.maxRows = options.maxRows;
		this.close = options.close;
	}

	private get bodyRows(): number {
		return Math.max(3, this.maxRows() - 4);
	}

	render(width: number): string[] {
		const { theme } = this;
		const inner = Math.max(10, width - 4);
		const edge = (text: string) => theme.fg("borderAccent", text);
		const title = ` ${theme.bold(this.title)} `;
		const top = `${edge("╭─")}${title}${edge("─".repeat(Math.max(0, width - 3 - visibleWidth(title))))}${edge("╮")}`;
		const rows = this.bodyRows;
		const visible = this.lines.slice(this.offset, this.offset + rows);
		const body = visible.map((line) => {
			const cut = truncateToWidth(line, inner, "…");
			return `${edge("│")} ${cut}${" ".repeat(Math.max(0, inner - visibleWidth(cut)))} ${edge("│")}`;
		});
		const more = this.lines.length > rows ? ` ${this.offset + 1}–${Math.min(this.lines.length, this.offset + rows)}/${this.lines.length} ↑↓ ` : "";
		const hint = ` Esc 关闭${more ? ` ·${more}` : " "}`;
		const bottom = `${edge("╰")}${edge("─".repeat(Math.max(0, width - 2 - visibleWidth(hint))))}${theme.fg("dim", hint)}${edge("╯")}`;
		return [top, ...body, bottom].map((line) => truncateToWidth(line, width, ""));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "enter") || data === "q") {
			this.close();
			return;
		}
		const max = Math.max(0, this.lines.length - this.bodyRows);
		if (matchesKey(data, "up")) this.offset = Math.max(0, this.offset - 1);
		else if (matchesKey(data, "down")) this.offset = Math.min(max, this.offset + 1);
		else if (matchesKey(data, "pageUp")) this.offset = Math.max(0, this.offset - this.bodyRows);
		else if (matchesKey(data, "pageDown")) this.offset = Math.min(max, this.offset + this.bodyRows);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta) {
			const max = Math.max(0, this.lines.length - this.bodyRows);
			this.offset = Math.min(max, Math.max(0, this.offset + Math.sign(event.wheelDelta) * 3));
			return { handled: true, render: true };
		}
		return event.type === "click" ? { handled: true } : undefined;
	}

	invalidate(): void {}
}

/** pi-tui's layout protocol: a component with this method is laid out as a stack or scroll view. */
const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

/**
 * How pi lays a component out, read through the shared symbol rather than `instanceof`: the packed
 * 2pi bundles its own copy of pi-tui, so pi's VStack and ScrollView are not instances of 2pi's.
 */
function layoutNode(component: Component): { type: string; entries?: StackEntry[] } | undefined {
	const method = (component as unknown as Record<symbol, unknown>)[LAYOUT_NODE];
	return typeof method === "function" ? method.call(component) : undefined;
}

/**
 * pi hands a mouse event to the layout boxes under the pointer, innermost first, and passes over
 * stacks and scroll views that keep pi-tui's default handler. The packed 2pi's containers come
 * from its own copy of pi-tui, whose default handler pi does not recognise, so pi called it: that
 * handler stacks the columns top to bottom, and a press anywhere below the transcript's last line
 * went to the divider. The containers 2pi adds take no events; the layout reaches their children.
 */
function layoutOnly<T extends Component>(component: T): T {
	component.handleMouse = () => undefined;
	return component;
}

/**
 * Transcript | divider | panel. An HStack with grow weights would not give the exact share
 * (pi-tui hands out the remainder greedily), so the column widths are computed for every frame
 * from the terminal width; the row always spans the full terminal.
 */
export class SplitRow extends Container {
	private readonly left: Component;
	private readonly splitter: Component;
	private readonly side: Component;
	private readonly widths: () => { left: number; right: number } | undefined;

	constructor(left: Component, splitter: Component, side: Component, widths: () => { left: number; right: number } | undefined) {
		super();
		this.left = left;
		this.splitter = splitter;
		this.side = side;
		this.widths = widths;
		this.children.push(left, splitter, side);
	}

	[LAYOUT_NODE]() {
		const widths = this.widths();
		const entries: StackEntry[] = widths
			? [
					{ component: this.left, basis: widths.left, grow: 0, shrink: 1, minSize: 1 },
					{ component: this.splitter, basis: 1, grow: 0, shrink: 0 },
					{ component: this.side, basis: widths.right, grow: 1, shrink: 1, minSize: 1 },
				]
			: [{ component: this.left, basis: 0, grow: 1, shrink: 1, minSize: 1 }];
		return { type: "hstack" as const, entries, gap: 0, align: "stretch" as const };
	}

	/** Outside a viewport (pi printing the transcript on exit) only the transcript is a document. */
	render(width: number): string[] {
		return this.left.render(width);
	}
}

/** Fields of pi-tui objects 2pi reads but the type declarations keep private or protected. */
interface Internals {
	layoutRoot?: Component;
}

/** Find pi's two parts in its fullscreen root: the transcript and the dock below it. */
function piParts(root: Component): { transcript: StackEntry; dock: StackEntry } | undefined {
	const node = layoutNode(root);
	if (node?.type !== "vstack" || node.entries?.length !== 2) return undefined;
	const [transcript, dock] = node.entries as [StackEntry, StackEntry];
	return layoutNode(transcript.component)?.type === "scroll" ? { transcript, dock } : undefined;
}

export interface SplitViewOptions {
	tui: TUI;
	flow: FlowModel;
	theme: () => Theme;
	prefs: SplitPrefs;
	savePrefs: (prefs: SplitPrefs) => void;
	/** Called when the panel appears or disappears (the plan widget moves accordingly). */
	onVisibilityChange?: (visible: boolean) => void;
}

export class SplitView {
	readonly prefs: SplitPrefs;
	private readonly tui: TUI;
	private readonly flow: FlowModel;
	private readonly theme: () => Theme;
	private readonly savePrefs: (prefs: SplitPrefs) => void;
	private readonly onVisibilityChange?: (visible: boolean) => void;
	private readonly panel: FlowPanel;
	private readonly splitter: Splitter;
	private readonly side: ScrollView;
	private original?: Component;
	private wrapped?: Component;
	private timer?: ReturnType<typeof setInterval>;
	private lastSecond = -1;
	private detail?: OverlayHandle;
	private wasVisible = false;
	private dirty = true;

	constructor(options: SplitViewOptions) {
		this.tui = options.tui;
		this.flow = options.flow;
		this.theme = options.theme;
		this.prefs = { ...options.prefs };
		this.savePrefs = options.savePrefs;
		this.onVisibilityChange = options.onVisibilityChange;
		this.flow.view = this.prefs.view;
		this.panel = new FlowPanel(this.flow, this.theme, (key) => this.select(key));
		this.side = layoutOnly(new ScrollView(this.panel, { follow: "none", overscroll: "contain", scrollbar: "auto" }));
		this.splitter = new Splitter({
			rows: () => this.tui.terminal.rows,
			theme: this.theme,
			onDrag: (x) => this.dragTo(x),
			onRelease: () => this.savePrefs(this.prefs),
		});
	}

	private get internals(): Internals {
		return this.tui as unknown as Internals;
	}

	/** The panel is on screen: fullscreen mode, enabled, wide enough, and wrapped in. */
	get visible(): boolean {
		return (
			this.prefs.enabled &&
			this.tui.mode === "fullscreen" &&
			this.tui.terminal.columns >= MIN_SPLIT_WIDTH &&
			!!this.wrapped &&
			this.internals.layoutRoot === this.wrapped
		);
	}

	/** Wrap pi's current layout root, or unwrap it when the panel is off. Cheap when nothing changed. */
	ensure(): void {
		if (this.tui.mode !== "fullscreen") return;
		const current = this.internals.layoutRoot;
		if (!current) return;
		if (!this.prefs.enabled) {
			if (current === this.wrapped && this.original) this.setRoot(this.original);
			return;
		}
		if (current === this.wrapped) return;
		this.original = current;
		this.wrapped = this.build(current);
		this.setRoot(this.wrapped);
	}

	private setRoot(root: Component): void {
		(this.tui as unknown as { setLayoutRoot(component: Component | undefined): void }).setLayoutRoot(root);
		this.tui.requestRender();
	}

	private build(root: Component): Component {
		const parts = piParts(root);
		const row = layoutOnly(new SplitRow(parts ? parts.transcript.component : root, this.splitter, this.side, () => this.columns()));
		if (!parts) return row;
		return layoutOnly(
			new VStack([
				{ component: row, basis: 0, grow: 1, shrink: 1, minSize: 1 },
				{ ...parts.dock },
			]),
		);
	}

	/** Column widths for this frame, or undefined when the panel does not fit. */
	private columns(): { left: number; right: number } | undefined {
		const width = this.tui.terminal.columns;
		if (!this.prefs.enabled || width < MIN_SPLIT_WIDTH) return undefined;
		const left = Math.floor((width - 1) * clampRatio(this.prefs.ratio, width));
		return { left, right: width - 1 - left };
	}

	private dragTo(screenX: number): void {
		this.prefs.ratio = clampRatio(screenX / Math.max(1, this.tui.terminal.columns - 1), this.tui.terminal.columns);
		this.tui.requestRender();
	}

	/** Left column share as a whole percentage, e.g. 70. */
	setRatio(percent: number): void {
		this.prefs.ratio = clampRatio(percent / 100, this.tui.terminal.columns);
		this.tui.requestRender();
		this.savePrefs(this.prefs);
	}

	setEnabled(enabled: boolean): void {
		this.prefs.enabled = enabled;
		this.savePrefs(this.prefs);
		this.ensure();
		this.notifyVisibility();
	}

	toggle(): boolean {
		this.setEnabled(!this.prefs.enabled);
		return this.prefs.enabled;
	}

	/** Show the track or the tree; the choice is kept with the other preferences. */
	setView(view: FlowView): void {
		this.prefs.view = view;
		this.flow.view = view;
		this.savePrefs(this.prefs);
		this.redraw();
	}

	toggleView(): FlowView {
		this.setView(this.prefs.view === "tree" ? "track" : "tree");
		return this.prefs.view;
	}

	private redraw(): void {
		this.dirty = true;
		this.tui.requestRender();
	}

	private notifyVisibility(): void {
		const visible = this.visible;
		if (visible !== this.wasVisible) {
			this.wasVisible = visible;
			this.onVisibilityChange?.(visible);
		}
	}

	/** Start the frame ticker: animations while lively, the run clock once a second. */
	start(): void {
		this.ensure();
		this.notifyVisibility();
		this.timer ??= setInterval(() => this.tick(), 70);
		this.timer.unref?.();
	}

	private tick(): void {
		this.ensure();
		this.notifyVisibility();
		if (!this.visible) return;
		this.panel.frame += 1;
		const lively = this.flow.advance();
		const second = Math.floor(Date.now() / 1000);
		if (lively || this.dirty || (this.flow.isRunning && second !== this.lastSecond)) {
			this.lastSecond = second;
			this.dirty = false;
			this.tui.requestRender();
		}
	}

	/** The flow changed: draw it on the next tick (ticks are frequent; events can be many). */
	refresh(): void {
		this.dirty = true;
	}

	/** A click on the panel: the footer switches the view, a group row folds, a step opens. */
	private select(key: string): void {
		if (key === VIEW_KEY) this.toggleView();
		else if (this.flow.toggleGroup(key)) this.redraw();
		else this.openDetail(key);
	}

	private openDetail(key: string): void {
		this.detail?.hide();
		const theme = this.theme();
		const { title, lines } = this.flow.detail(key, theme);
		const view = new DetailView({
			title,
			lines: lines.length > 0 ? lines : [theme.fg("dim", "没有记录。")],
			theme,
			maxRows: () => Math.floor(this.tui.terminal.rows * 0.8),
			close: () => {
				this.detail?.hide();
				this.detail = undefined;
			},
		});
		this.detail = this.tui.showOverlay(view, { anchor: "right-center", width: "55%", minWidth: 48, maxHeight: "80%", margin: 1 });
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.detail?.hide();
		if (this.original && this.internals.layoutRoot === this.wrapped) this.setRoot(this.original);
	}
}
