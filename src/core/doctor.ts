import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Pack } from "../packs/types.ts";
import { AGENT_ROOT, ENV_PREFIX, env, resolvePython } from "./config.ts";
import { request } from "./online.ts";
import { PROJECT_FILE, readProjectCard } from "./project.ts";

/**
 * /doctor: what 2pi needs, checked for real. Local tools are looked up and run; online services get
 * one fixed test request each (no project words), so a failure shows up here instead of halfway
 * through a literature search. Packs add their own checks through Pack.doctor.
 */

export type DoctorStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
	group: string;
	name: string;
	status: DoctorStatus;
	detail: string;
	/** What to do about it, when there is something to do. */
	fix?: string;
	/** The service answered and refused the configured key (/setup then keeps the previous one). */
	credentialsRejected?: boolean;
}

export interface DoctorOptions {
	signal?: AbortSignal;
}

export const GROUP_ORDER = ["模型与环境", "本项目", "文献检索", "专利检索", "论文排版", "专利文件"];

/** TWOPI_OFFLINE=1: the online checks are skipped, as pi skips its own network use. */
export function offline(): boolean {
	return /^(1|true|yes)$/i.test(env("OFFLINE") ?? "");
}

export interface ProbeResult {
	status: number;
	text: string;
}

/** One request with a short timeout and no retries: a check must answer quickly. */
export async function probe(url: string, options: DoctorOptions = {}): Promise<ProbeResult> {
	const res = await request(url, { signal: options.signal, timeoutMs: 12_000, retries: 0 });
	const text = res.text ? await res.text() : JSON.stringify(await res.json());
	return { status: res.status, text };
}

/** A network failure in words a user can act on. */
export function networkFix(host: string, error: unknown): Pick<DoctorCheck, "detail" | "fix"> {
	const message = error instanceof Error ? error.message : String(error);
	const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
	return {
		detail: `连不上 ${host}（${message}）`,
		fix: proxy ? `检查代理 ${proxy} 是否可用` : "检查网络；需要代理时设置环境变量 HTTPS_PROXY 后重新启动 2pi",
	};
}

function pythonVersion(command: string, args: string[]): string | undefined {
	const out = spawnSync(command, [...args, "-c", "import sys; print(sys.version.split()[0])"], { encoding: "utf8", windowsHide: true });
	return out.status === 0 ? out.stdout.trim() : undefined;
}

function pythonHas(command: string, args: string[], module: string): boolean {
	return spawnSync(command, [...args, "-c", `import ${module}`], { stdio: "ignore", windowsHide: true }).status === 0;
}

export function coreChecks(ctx: Pick<ExtensionContext, "cwd" | "model" | "modelRegistry">): DoctorCheck[] {
	const checks: DoctorCheck[] = [];
	const group = GROUP_ORDER[0]!;
	const model = ctx.model;
	if (!model) {
		checks.push({ group, name: "模型", status: "fail", detail: "还没有选择模型", fix: "用 /login 登录模型服务，再用 /model 选择模型" });
	} else {
		const label = `${model.provider}/${model.id}`;
		checks.push(
			ctx.modelRegistry.hasConfiguredAuth(model)
				? { group, name: "模型", status: "ok", detail: `${label}，凭据已配置` }
				: { group, name: "模型", status: "fail", detail: `${label} 没有可用的凭据`, fix: `用 /login ${model.provider} 登录或填写 API Key` },
		);
	}

	try {
		const python = resolvePython();
		const command = [python.command, ...python.args].join(" ");
		checks.push({ group, name: "Python", status: "ok", detail: `${command}（${pythonVersion(python.command, python.args) ?? "版本未知"}）` });
		const missing = [
			["PIL", "Pillow（专利附图）"],
			["fitz", "PyMuPDF（读取 PDF 全文与页面）"],
		].filter(([module]) => !pythonHas(python.command, python.args, module!));
		checks.push(
			missing.length === 0
				? { group, name: "Python 依赖", status: "ok", detail: "Pillow、PyMuPDF 已安装" }
				: {
						group,
						name: "Python 依赖",
						status: "warn",
						detail: `缺少 ${missing.map(([, label]) => label).join("、")}`,
						fix: `${command} -m pip install -r "${join(AGENT_ROOT, "python", "requirements.txt")}"`,
					},
		);
	} catch (error) {
		checks.push({
			group,
			name: "Python",
			status: "fail",
			detail: error instanceof Error ? error.message : String(error),
			fix: `安装 Python 3.9 以上版本，或设置环境变量 ${ENV_PREFIX}PYTHON 指向 python 可执行文件`,
		});
	}

	const card = readProjectCard(ctx.cwd);
	const project = GROUP_ORDER[1]!;
	if (!card.path) {
		checks.push({ group: project, name: "项目卡", status: "skip", detail: `当前目录没有 ${PROJECT_FILE}`, fix: "用 /init 建立项目" });
	} else {
		checks.push(
			card.onlineSearch
				? { group: project, name: "联网检索", status: "ok", detail: `${PROJECT_FILE} 允许联网检索` }
				: {
						group: project,
						name: "联网检索",
						status: "warn",
						detail: `${PROJECT_FILE} 没有允许联网检索，每个会话第一次检索前会询问`,
						fix: "在 /setup 中开启（尚未申请的发明请保持关闭）",
					},
		);
	}
	return checks;
}

/** Core checks plus every installed pack's, network checks in parallel. */
export async function runDoctor(ctx: Pick<ExtensionContext, "cwd" | "model" | "modelRegistry">, packs: Pack[], options: DoctorOptions = {}) {
	const fromPacks = await Promise.all(
		packs.map(async (pack) => {
			try {
				return (await pack.doctor?.(ctx.cwd, options)) ?? [];
			} catch (error) {
				return [{ group: pack.id, name: pack.id, status: "fail", detail: error instanceof Error ? error.message : String(error) } satisfies DoctorCheck];
			}
		}),
	);
	const checks = [...coreChecks(ctx), ...fromPacks.flat()];
	const rank = (group: string) => (GROUP_ORDER.includes(group) ? GROUP_ORDER.indexOf(group) : GROUP_ORDER.length);
	return checks.map((check, index) => ({ check, index })).sort((a, b) => rank(a.check.group) - rank(b.check.group) || a.index - b.index).map((x) => x.check);
}

const MARK: Record<DoctorStatus, string> = { ok: "✓", warn: "!", fail: "✗", skip: "–" };

export function formatDoctor(checks: DoctorCheck[]): string {
	const lines = ["2pi 检测（联网检测只发送固定的测试请求，不含项目内容）"];
	let group = "";
	for (const check of checks) {
		if (check.group !== group) {
			group = check.group;
			lines.push("", group);
		}
		lines.push(`  ${MARK[check.status]} ${check.name}：${check.detail}${check.fix ? `\n      → ${check.fix}` : ""}`);
	}
	const count = (status: DoctorStatus) => checks.filter((check) => check.status === status).length;
	lines.push("", `共 ${checks.length} 项：${count("ok")} 正常、${count("warn")} 需要留意、${count("fail")} 失败、${count("skip")} 未检测。`);
	if (count("fail") + count("warn") > 0) lines.push("检索服务的 key 和本项目的联网许可都可以在 /setup 中设置。");
	return lines.join("\n");
}
