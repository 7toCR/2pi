import { writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Pack } from "../packs/types.ts";
import { ENV_PREFIX } from "./config.ts";
import { type DoctorCheck, type DoctorStatus, formatDoctor, runDoctor } from "./doctor.ts";
import { SEARCH_SERVICES } from "./online.ts";
import { PROJECT_FILE, readProjectCard } from "./project.ts";
import { describeKey, maskKey, type ServiceKey, saveServiceKeys, serviceKey, serviceKeySource, servicesPath } from "./services.ts";

/**
 * /setup and /doctor. /setup saves the research services' keys in 2pi's config directory and
 * switches the project's online-search permission; /doctor checks the model login, local tools and
 * every online service for real. Both work without editing environment variables.
 */

const ONLINE_FIELD = /^(\s*[-*]?\s*(?:联网检索|Online search)\s*[:：]\s*).*$/im;

/** The project card with 联网检索 set; a card without the field gets a 调研 section with it. */
export function setOnlineSearch(content: string, allowed: boolean): string {
	const value = allowed ? "允许" : "不允许";
	if (ONLINE_FIELD.test(content)) return content.replace(ONLINE_FIELD, `$1${value}`);
	const nl = content.includes("\r\n") ? "\r\n" : "\n";
	return `${content.replace(/\s*$/, "")}${nl}${nl}## 调研${nl}${nl}- 联网检索：${value}${nl}`;
}

const DISCLOSURE = `允许后，本项目的每次检索都会把检索词发送给 ${SEARCH_SERVICES}，不再逐个会话询问；论文、稿件和材料不会上传。尚未申请的发明，检索词本身也可能泄露发明点。`;

function epoStatus(agentDir?: string): string {
	const key = describeKey("EPO_OPS_KEY", agentDir);
	const secret = describeKey("EPO_OPS_SECRET", agentDir);
	return key === "未配置" && secret === "未配置" ? "未配置" : `key ${key}，secret ${secret}`;
}

export function setupStatus(cwd: string, agentDir?: string): string {
	const card = readProjectCard(cwd);
	return [
		`2pi 设置（检索服务的 key 保存在 ${servicesPath(agentDir)}；设置了同名环境变量 ${ENV_PREFIX}… 时以环境变量为准）`,
		`- OpenAlex API key：${describeKey("OPENALEX_KEY", agentDir)}（可选；不配置时用免费额度，约每天 100 次检索）`,
		`- EPO OPS 专利检索账号：${epoStatus(agentDir)}（可选；不配置时专利检索给出链接，导出 CSV 后导入）`,
		card.path ? `- 本项目联网检索：${card.onlineSearch ? "允许" : "不允许"}（${PROJECT_FILE}）` : `- 本项目联网检索：当前目录没有 ${PROJECT_FILE}`,
		"",
		"/setup 交互设置 · /setup openalex <key> · /setup epo <key> <secret> · /setup clear openalex|epo · /setup online on|off · /doctor 检测",
	].join("\n");
}

function envNote(names: ServiceKey[], agentDir?: string): string {
	const shadowed = names.filter((name) => serviceKeySource(name, agentDir) === "env");
	return shadowed.length > 0 ? `\n注意：环境变量 ${shadowed.map((name) => ENV_PREFIX + name).join("、")} 已设置，它优先于这里保存的值。` : "";
}

/** /setup with arguments (also what scripts and non-interactive runs use). Undefined: not understood. */
export function runSetupArgs(args: string, cwd: string, agentDir?: string): { text: string; level: "info" | "warning" } | undefined {
	const [verb = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
	const what = verb.toLowerCase();
	if (!what || what === "status") return { text: setupStatus(cwd, agentDir), level: "info" };
	if (what === "openalex") {
		if (rest.length !== 1) return { text: "用法：/setup openalex <key>", level: "warning" };
		saveServiceKeys({ OPENALEX_KEY: rest[0] }, agentDir);
		return { text: `已保存 OpenAlex key（${maskKey(rest[0]!)}）。用 /doctor 检测它是否有效。${envNote(["OPENALEX_KEY"], agentDir)}`, level: "info" };
	}
	if (what === "epo") {
		if (rest.length !== 2) return { text: "用法：/setup epo <key> <secret>", level: "warning" };
		saveServiceKeys({ EPO_OPS_KEY: rest[0], EPO_OPS_SECRET: rest[1] }, agentDir);
		return { text: `已保存 EPO OPS 账号（key ${maskKey(rest[0]!)}）。用 /doctor 检测它是否有效。${envNote(["EPO_OPS_KEY", "EPO_OPS_SECRET"], agentDir)}`, level: "info" };
	}
	if (what === "clear") {
		const target = rest[0]?.toLowerCase();
		const names: ServiceKey[] | undefined =
			target === "openalex" ? ["OPENALEX_KEY"] : target === "epo" ? ["EPO_OPS_KEY", "EPO_OPS_SECRET"] : target === "all" ? ["OPENALEX_KEY", "EPO_OPS_KEY", "EPO_OPS_SECRET"] : undefined;
		if (!names) return { text: "用法：/setup clear openalex|epo|all", level: "warning" };
		saveServiceKeys(Object.fromEntries(names.map((name) => [name, undefined])), agentDir);
		return { text: `已清除保存的 ${target === "all" ? "全部 key" : target === "epo" ? "EPO OPS 账号" : "OpenAlex key"}。${envNote(names, agentDir)}`, level: "info" };
	}
	if (what === "online") {
		const state = rest[0]?.toLowerCase();
		if (state !== "on" && state !== "off") return { text: "用法：/setup online on|off", level: "warning" };
		const card = readProjectCard(cwd);
		if (!card.path || card.content === undefined) return { text: `当前目录没有 ${PROJECT_FILE}；先用 /init 建立项目。`, level: "warning" };
		writeFileSync(card.path, setOnlineSearch(card.content, state === "on"), "utf8");
		return state === "on"
			? { text: `${PROJECT_FILE} 已改为"联网检索：允许"。${DISCLOSURE}`, level: "info" }
			: { text: `${PROJECT_FILE} 已改为"联网检索：不允许"；每个会话第一次检索前会询问。`, level: "info" };
	}
	return undefined;
}

/** Dialogs and notifications in the terminal UI; plain output in print mode (2pi -p "/doctor"). */
function say(ctx: ExtensionCommandContext, text: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(text, level);
	else console.log(text);
}

const worst = (checks: DoctorCheck[]): "info" | "warning" | "error" =>
	checks.some((c) => c.status === "fail") ? "error" : checks.some((c) => c.status === "warn") ? "warning" : "info";

async function doctor(ctx: ExtensionCommandContext, packs: Pack[]): Promise<DoctorCheck[]> {
	if (ctx.hasUI) ctx.ui.notify("正在检测模型、本地工具和检索服务…", "info");
	const checks = await runDoctor(ctx, packs, { signal: ctx.signal });
	say(ctx, formatDoctor(checks), worst(checks));
	return checks;
}

/**
 * Save new keys, then check them for real. A service that answers and refuses them gets the
 * previous keys back, so a typo never replaces a key that worked.
 */
async function saveAndCheck(ctx: ExtensionCommandContext, packs: Pack[], values: Partial<Record<ServiceKey, string>>, service: string) {
	const names = Object.keys(values) as ServiceKey[];
	if (names.some((name) => serviceKeySource(name) === "env")) {
		// The environment variable is what the services see, so checking would test the wrong key.
		saveServiceKeys(values);
		ctx.ui.notify(`${service} 已保存。${envNote(names).trim()}`, "warning");
		return;
	}
	const previous = Object.fromEntries(names.map((name) => [name, serviceKeySource(name) === "saved" ? serviceKey(name) : undefined]));
	saveServiceKeys(values);
	const research = packs.filter((pack) => pack.id === "research");
	const check = (await runDoctor(ctx, research, { signal: ctx.signal })).find((c) => c.name === service);
	if (check?.credentialsRejected) {
		saveServiceKeys(previous);
		ctx.ui.notify(`${service}：${check.detail}。没有保存，原来的设置保持不变。`, "error");
		return;
	}
	const mark: Record<DoctorStatus, string> = { ok: "已验证可用", warn: "已保存，但检测有提醒", fail: "已保存，但未能验证", skip: "已保存" };
	const line = check ? `${mark[check.status]}：${check.detail}${check.fix && check.status !== "ok" ? `（${check.fix}）` : ""}` : "已保存";
	ctx.ui.notify(`${service} ${line}${envNote(names)}`, check?.status === "fail" ? "warning" : "info");
}

async function interactiveSetup(ctx: ExtensionCommandContext, packs: Pack[]): Promise<void> {
	for (;;) {
		const card = readProjectCard(ctx.cwd);
		const items = {
			openalex: `OpenAlex API key：${describeKey("OPENALEX_KEY")}`,
			epo: `EPO OPS 专利检索账号：${epoStatus()}`,
			online: card.path ? `本项目联网检索：${card.onlineSearch ? "允许" : "不允许"}（${PROJECT_FILE}）` : undefined,
			doctor: "检测全部配置（/doctor）",
			done: "完成",
		};
		const choice = await ctx.ui.select("2pi 设置：选择要修改的项目", Object.values(items).filter((item): item is string => !!item));
		if (!choice || choice === items.done) return;
		if (choice === items.doctor) {
			await doctor(ctx, packs);
		} else if (choice === items.openalex) {
			const action = await ctx.ui.select("OpenAlex API key（可选：提高文献检索额度）", ["填写新的 key", "清除已保存的 key", "返回"]);
			if (action === "填写新的 key") {
				const key = (await ctx.ui.input("粘贴 OpenAlex API key（在 openalex.org 登录账号后获取；只保存在本机）", ""))?.trim();
				if (key) await saveAndCheck(ctx, packs, { OPENALEX_KEY: key }, "OpenAlex");
			} else if (action === "清除已保存的 key") {
				ctx.ui.notify(runSetupArgs("clear openalex", ctx.cwd)?.text ?? "", "info");
			}
		} else if (choice === items.epo) {
			const action = await ctx.ui.select("EPO OPS 账号（可选：直接检索全球专利，含中国专利）", ["填写 key 和 secret", "清除已保存的账号", "返回"]);
			if (action === "填写 key 和 secret") {
				const key = (await ctx.ui.input("EPO OPS Consumer Key（在 EPO 开发者门户免费注册应用后获取）", ""))?.trim();
				const secret = key ? (await ctx.ui.input("EPO OPS Consumer Secret", ""))?.trim() : undefined;
				if (key && secret) await saveAndCheck(ctx, packs, { EPO_OPS_KEY: key, EPO_OPS_SECRET: secret }, "EPO OPS");
			} else if (action === "清除已保存的账号") {
				ctx.ui.notify(runSetupArgs("clear epo", ctx.cwd)?.text ?? "", "info");
			}
		} else if (choice === items.online && card.path) {
			const allow = !card.onlineSearch;
			const ok = allow
				? await ctx.ui.confirm("允许本项目联网检索？", DISCLOSURE)
				: await ctx.ui.confirm("关闭本项目联网检索？", "关闭后，每个会话第一次检索前会询问。");
			if (ok) ctx.ui.notify(runSetupArgs(`online ${allow ? "on" : "off"}`, ctx.cwd)?.text ?? "", "info");
		}
	}
}

export function registerSetupCommands(pi: ExtensionAPI, packs: Pack[]): void {
	pi.registerCommand("setup", {
		description: "设置检索服务的 key（OpenAlex、EPO OPS）和本项目的联网检索许可；/setup status 查看当前设置",
		getArgumentCompletions: (prefix) =>
			["status", "openalex", "epo", "clear", "online"].filter((value) => value.startsWith(prefix.trim())).map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			if (!args.trim() && ctx.hasUI) {
				await interactiveSetup(ctx, packs);
				return;
			}
			const result = runSetupArgs(args, ctx.cwd);
			if (!result) {
				say(ctx, `不认识的参数：${args.trim()}\n${setupStatus(ctx.cwd)}`, "warning");
				return;
			}
			say(ctx, result.text, result.level);
		},
	});

	pi.registerCommand("doctor", {
		description: "检测模型登录、Python 与 LaTeX 等本地工具、各检索服务（只发送固定的测试请求）",
		handler: async (_args, ctx) => {
			await doctor(ctx, packs);
		},
	});
}
