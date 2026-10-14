import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Pack } from "../packs/types.ts";
import { initProject, PROJECT_FILE, PROJECT_TYPES, type ProjectType } from "./project.ts";

/** Create the project layout plus each chosen domain's part (e.g. the LaTeX skeleton for paper). */
export function initTwoPiProject(cwd: string, type: ProjectType, packs: Pack[]): string {
	const ids = type === "both" ? ["paper", "patent"] : [type];
	const created = initProject(cwd, type);
	for (const pack of packs) if (ids.includes(pack.id)) created.push(...(pack.init?.(cwd) ?? []));
	const unique = [...new Set(created)];
	const missing = ids.filter((id) => !packs.some((pack) => pack.id === id));
	return [
		unique.length > 0 ? `已建立 2pi 项目（${type}）：${unique.join("、")}` : `项目已存在（${type}），没有覆盖任何文件。`,
		`把材料放进 materials/，再按需要填写 ${PROJECT_FILE}。`,
		...(missing.length > 0 ? [`注意：${missing.join("、")} 领域尚未安装，目前只能使用 ${packs.map((pack) => pack.id).join("、")}。`] : []),
	].join("\n");
}

export function registerCoreCommands(pi: ExtensionAPI, packs: Pack[]): void {
	pi.registerCommand("init", {
		description: `在当前目录建立 2pi 项目（${PROJECT_FILE}、materials/、notes/ 等）：/init [paper|patent|both]`,
		getArgumentCompletions: (prefix) =>
			PROJECT_TYPES.filter((type) => type.startsWith(prefix.trim())).map((type) => ({ value: type, label: type })),
		handler: async (args, ctx) => {
			let type = PROJECT_TYPES.find((value) => value === args.trim());
			if (!type && args.trim()) {
				ctx.ui.notify(`用法：/init [${PROJECT_TYPES.join("|")}]`, "warning");
				return;
			}
			if (!type && ctx.hasUI) {
				const choice = await ctx.ui.select("这个项目要做什么？", [
					"patent：论文 → 专利申请初稿",
					"paper：材料 → 论文初稿",
					"both：材料 → 论文 → 专利",
				]);
				type = PROJECT_TYPES.find((value) => choice?.startsWith(value));
			}
			if (!type) return;
			ctx.ui.notify(initTwoPiProject(ctx.cwd, type, packs), "info");
		},
	});
}
