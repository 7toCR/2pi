import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { logSearch } from "./online.ts";
import { cleanPathArg, isInside, slash } from "./paths.ts";
import { readProjectCard, SCRATCH_DIR, STATE_DIR } from "./project.ts";
import type { CoreState } from "./state.ts";

/**
 * Codex-style `workspace-write` sandbox with an `on-request` approval policy, scaled down to what
 * a drafting agent needs: writes stay in the workspace, the author's material, the source paper
 * and the knowledge bases stay read-only, existing author files are not overwritten without a yes,
 * and commands that destroy data, rewrite git history, or upload files need a yes.
 */

const RISKY_COMMANDS: Array<[RegExp, string]> = [
	[/\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f|commit|filter-branch|rebase)\b/i, "改写或推送 git 历史（草稿与论文不应进入 git）"],
	[/\b(curl|wget)\b[^|;&]*(\s-F\b|\s--form\b|\s-T\b|--upload-file|--data-binary\s+@|-d\s+@)/i, "上传本地文件（论文可能尚未公开）"],
	[/\b(scp|sftp|rsync)\b[^|;&]*\S+:/i, "向远程主机复制文件"],
	[/\b(curl|wget|iwr|invoke-webrequest)\b[^|;&]*\|\s*(sh|bash|zsh|iex|invoke-expression|python)\b/i, "下载并直接执行脚本"],
	[/\b(mkfs|format\s+[a-z]:|diskpart|shutdown|reboot|reg\s+delete)\b/i, "系统级破坏性操作"],
	[/\bdd\s+if=/i, "原始磁盘写入"],
	[/\b(pip|pip3|npm|pnpm|yarn)\s+(uninstall|remove)\b/i, "卸载软件包"],
];

const DELETE_COMMAND = /^(rm|rmdir|rd|del|erase|remove-item|ri)$/i;

/** `-rf`, `-R`, `--recursive`, PowerShell `-Recurse`, cmd `/s`; not `-Force`. */
function isRecursiveFlag(token: string): boolean {
	if (/^(--recursive|-rec\w*|\/s)$/i.test(token)) return true;
	return /^-[a-zA-Z]{1,4}$/.test(token) && /r/i.test(token);
}

/** Recursive deletes are fine inside the workspace (e.g. clearing out/), risky anywhere else. */
function recursiveDeleteRisk(command: string, cwd: string): string | undefined {
	for (const segment of command.split(/&&|\|\||[;|\n]/)) {
		const tokens = segment
			.trim()
			.split(/\s+/)
			.map((token) => token.replace(/^["']|["']$/g, ""));
		const start = tokens.findIndex((token) => DELETE_COMMAND.test(token));
		if (start < 0) continue;
		const rest = tokens.slice(start + 1);
		if (!rest.some(isRecursiveFlag)) continue;
		const targets = rest.filter((token) => token && !token.startsWith("-") && !/^\/[a-z]$/i.test(token));
		const unsafe =
			targets.length === 0 ||
			targets.some(
				(target) =>
					/^(\/|~|\$|%|[a-z]:)/i.test(target) ||
					target.includes("..") ||
					target === "." ||
					target === "*" ||
					!isInside(resolve(cwd, target), cwd),
			);
		if (unsafe) return "递归删除工作目录之外或范围不明确的路径";
	}
	return undefined;
}

/** Shell commands that delete, move or overwrite files. */
const MUTATING = /(?:\brm\b|\brmdir\b|\bmv\b|\bsed\s+-i|\btruncate\b|\bshred\b|Remove-Item|Move-Item|Rename-Item|Set-Content|Add-Content|Clear-Content|Out-File|\bdel\b|\berase\b|\bren\b)/i;

/** A command that would change the author's material folder (heuristic, from research2paper). */
function materialsRisk(command: string, cwd: string, materials: string): string | undefined {
	const folder = slash(relative(cwd, materials)) || "materials";
	const escaped = folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const mentions = new RegExp(`(?:^|[\\s"'=/\\\\])${escaped}(?:[\\\\/]|\\b)`, "i");
	const redirectInto = new RegExp(`>>?\\s*["']?[^\\s|;&]*${escaped}[\\\\/]`, "i");
	const mutates =
		command.split(/&&|\|\||;|\|/).some((segment) => MUTATING.test(segment) && mentions.test(segment)) ||
		redirectInto.test(command);
	return mutates ? `命令可能修改 ${folder}/（作者原始材料，只读）` : undefined;
}

export function commandRisk(command: string, cwd: string, materials = join(cwd, "materials")): string | undefined {
	for (const [pattern, reason] of RISKY_COMMANDS) {
		if (pattern.test(command)) return reason;
	}
	return recursiveDeleteRisk(command, cwd) ?? materialsRisk(command, cwd, materials);
}

/** Commands that fetch from the network: blocked unless online search is allowed (they could carry query words). */
const NETWORK_COMMAND =
	/\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|start-bitstransfer)\b|\bpython[\d.]*\b[^|;&]*\s-c\b[^|;&]*\b(urllib|requests|httpx|http\.client)\b/i;

export function networkRisk(command: string): string | undefined {
	return NETWORK_COMMAND.test(command) ? '联网请求（项目卡没有允许联网检索；检索请用调研工具，需要用户授权）' : undefined;
}

export interface WriteContext {
	cwd: string;
	core: CoreState;
	/** The author's material folder (2PI.md 材料目录, default materials/). */
	materials: string;
	/** Files and folders the agent's drafts live in. */
	agentAreas: string[];
	/** The agent changed this file in an earlier turn (from the change sets). */
	touchedBefore: (path: string) => boolean;
}

export type WriteDecision = { action: "allow" } | { action: "block" | "confirm"; reason: string };

/**
 * Decide on a write/edit:
 * - materials/ is read-only, and so is .2pi/ apart from its scratch folder;
 * - the knowledge bases, the agent itself, source papers, and paths outside the workspace need a yes;
 * - an existing file outside the agent's areas may be the author's original: changing it needs a yes
 *   (research2paper saw a real project whose paper/ held related papers, not the draft).
 */
export function writeDecision(target: string, context: WriteContext): WriteDecision {
	const { cwd, core } = context;
	if (isInside(target, context.materials)) {
		return { action: "block", reason: `${slash(relative(cwd, target))} 在作者原始材料目录中，只读。派生文件请写到稿件或说明旁边。` };
	}
	if (isInside(target, join(cwd, STATE_DIR)) && !isInside(target, join(cwd, SCRATCH_DIR))) {
		return { action: "block", reason: `${STATE_DIR}/ 是 agent 状态目录（检查点、修改记录、解析结果），不能直接写入；临时文件请放 ${SCRATCH_DIR}/。` };
	}
	if (core.readOnlyRoots.some((root) => isInside(target, root))) {
		return { action: "confirm", reason: `该路径是只读的（论文原件、知识库或 agent 自身）：${target}` };
	}
	if (!isInside(target, cwd) && !isInside(target, tmpdir())) {
		return { action: "confirm", reason: `该路径在工作目录之外：${target}` };
	}
	const owned =
		!existsSync(target) ||
		core.isCreated(target) ||
		context.touchedBefore(target) ||
		(isInside(target, tmpdir()) && !isInside(target, cwd)) ||
		context.agentAreas.some((area) => isInside(target, area));
	if (owned) return { action: "allow" };
	return {
		action: "confirm",
		reason: `${slash(relative(cwd, target))} 不在稿件目录内，可能是作者的原始文件；修订通常应写到新文件。`,
	};
}

async function approveOrBlock(ctx: ExtensionContext, title: string, detail: string): Promise<ToolCallEventResult | undefined> {
	if (ctx.hasUI && (await ctx.ui.confirm(`需要确认：${title}`, `${detail}\n\n是否允许？`))) return undefined;
	return {
		block: true,
		reason: ctx.hasUI
			? `用户拒绝：${title}。${detail}`
			: `非交互模式下自动拒绝：${title}。${detail} 修订请写到新文件；确需执行时请用户以 --full-access 启动。`,
	};
}

export function installGuard(pi: ExtensionAPI, core: CoreState, contextFor: (cwd: string) => WriteContext): void {
	pi.registerFlag("full-access", {
		type: "boolean",
		description: "关闭写入沙箱与高危命令确认（2pi）",
		default: false,
	});

	pi.on("tool_call", async (event, ctx) => {
		if (pi.getFlag("full-access") === true) return undefined;
		if (event.toolName === "write" || event.toolName === "edit") {
			const raw = typeof event.input.path === "string" ? event.input.path : "";
			const target = resolve(ctx.cwd, cleanPathArg(raw));
			const isNew = event.toolName === "write" && !existsSync(target);
			const decision = writeDecision(target, contextFor(ctx.cwd));
			if (decision.action === "block") return { block: true, reason: decision.reason };
			if (decision.action === "confirm") {
				const blocked = await approveOrBlock(ctx, "写入受限路径", decision.reason);
				if (blocked) return blocked;
			}
			if (isNew) core.markCreated(target);
		}
		if (event.toolName === "bash" || event.toolName === "powershell") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			const risk = commandRisk(command, ctx.cwd, contextFor(ctx.cwd).materials);
			if (risk) return approveOrBlock(ctx, "高危命令", `${risk}：${command}`);
			const network = networkRisk(command);
			if (network && !(core.onlineGranted || readProjectCard(ctx.cwd).onlineSearch)) {
				return approveOrBlock(ctx, "联网命令", `${network}：${command}`);
			}
			// Allowed, but what leaves the machine is still recorded next to the research tools' queries.
			if (network) logSearch(ctx.cwd, { tool: event.toolName, service: "命令行", query: command.slice(0, 300) });
		}
		return undefined;
	});
}
