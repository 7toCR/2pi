import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";

/** Widgets above the editor in the same quiet style as the tool rows: one accent mark, the rest muted. */

export type WidgetFactory = (tui: unknown, theme: Theme) => Component;

class Lines implements Component {
	private readonly build: (width: number) => string[];
	constructor(build: (width: number) => string[]) {
		this.build = build;
	}
	render(width: number): string[] {
		return this.build(width).map((line) => truncateToWidth(line, width, "…"));
	}
	invalidate(): void {}
}

export interface PlanStep {
	step: string;
	status: "pending" | "in_progress" | "completed";
}

export function planWidget(plan: PlanStep[]): WidgetFactory {
	return (_tui, theme) =>
		new Lines(() => {
			const done = plan.filter((item) => item.status === "completed").length;
			return [
				` ${theme.fg("accent", "◆")} ${theme.bold("计划")} ${theme.fg("dim", `${done}/${plan.length}`)}`,
				...plan.map((item) =>
					item.status === "completed"
						? `   ${theme.fg("success", "✓")} ${theme.fg("dim", item.step)}`
						: item.status === "in_progress"
							? `   ${theme.fg("accent", "▶")} ${item.step}`
							: `   ${theme.fg("dim", "○")} ${theme.fg("muted", item.step)}`,
				),
			];
		});
}

export function changesWidget(id: string, description: string, summary: string | undefined): WidgetFactory {
	return (_tui, theme) =>
		new Lines(() => [
			` ${theme.fg("accent", "◆")} ${theme.bold("本轮修改")} ${theme.fg("dim", id)}  ${theme.fg("muted", description)}`,
			...(summary ? [`   ${theme.fg("dim", "原因")} ${theme.fg("muted", summary)}`] : []),
			`   ${theme.fg("dim", `/changes ${id} 逐块查看 · /redline 修订稿 · /undo 撤回`)}`,
		]);
}
