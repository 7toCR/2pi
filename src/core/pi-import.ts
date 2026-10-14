import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * `2pi import-pi`: 2pi is configured exactly like pi (its agent directory holds the same
 * models.json, auth.json and settings.json), so a pi setup carries over as it is:
 *
 * - models.json: every provider and model override from pi; a provider 2pi already has under
 *   the same id is replaced by pi's.
 * - settings.json: pi's default provider, model, thinking level and model cycle.
 * - auth.json: only credentials that are references (a `!command` or `$VARIABLE`), which hold no
 *   secret themselves. Stored API keys and OAuth tokens are not duplicated: sign in again with
 *   /login (OAuth refresh tokens can rotate, and two copies would log each other out), or run
 *   2pi with TWOPI_USE_PI_CONFIG=1 to use pi's directory directly.
 */

type Json = Record<string, unknown>;

function readJson(path: string): Json {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Json;
	} catch (error) {
		throw new Error(`${path} 不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`);
	}
}

function writeJson(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const DEFAULT_KEYS = ["defaultProvider", "defaultModel", "defaultThinkingLevel", "enabledModels"] as const;

export interface PiImportOptions {
	/** 2pi's agent directory. */
	agentDir: string;
	/** pi's agent directory; default ~/.pi/agent. */
	piDir?: string;
}

export function importPiConfig(options: PiImportOptions): string[] {
	const piDir = resolve(options.piDir ?? join(homedir(), ".pi", "agent"));
	const agentDir = resolve(options.agentDir);
	if (piDir.toLowerCase() === agentDir.toLowerCase()) throw new Error(`pi 与 2pi 用的是同一个配置目录（${piDir}），无需导入。`);
	if (!existsSync(piDir)) throw new Error(`找不到 pi 的配置目录 ${piDir}（可用 --pi-dir 指定）`);
	const lines: string[] = [`从 ${piDir} 导入到 ${agentDir}：`];

	const piModels = readJson(join(piDir, "models.json"));
	const providers = (piModels.providers ?? {}) as Record<string, Json>;
	const overrides = (piModels.modelOverrides ?? {}) as Json;
	const modelsPath = join(agentDir, "models.json");
	if (Object.keys(providers).length > 0 || Object.keys(overrides).length > 0) {
		const ours = readJson(modelsPath);
		const ourProviders = (ours.providers ?? {}) as Record<string, Json>;
		const replaced = Object.keys(providers).filter((id) => id in ourProviders);
		ours.providers = { ...ourProviders, ...providers };
		if (Object.keys(overrides).length > 0) ours.modelOverrides = { ...((ours.modelOverrides ?? {}) as Json), ...overrides };
		writeJson(modelsPath, ours);
		const names = Object.entries(providers).map(([id, value]) => {
			const count = Array.isArray(value.models) ? value.models.length : 0;
			return `${id}${count ? `（${count} 个模型）` : ""}`;
		});
		lines.push(`- models.json：provider ${names.join("、") || "无"}${replaced.length ? `；替换了同名的 ${replaced.join("、")}` : ""}`);
	} else {
		lines.push("- models.json：pi 没有自定义 provider，跳过");
	}

	const piSettings = readJson(join(piDir, "settings.json"));
	const defaults = Object.fromEntries(DEFAULT_KEYS.filter((key) => piSettings[key] !== undefined).map((key) => [key, piSettings[key]]));
	if (Object.keys(defaults).length > 0) {
		const settingsPath = join(agentDir, "settings.json");
		writeJson(settingsPath, { ...readJson(settingsPath), ...defaults });
		const model = defaults.defaultProvider && defaults.defaultModel ? `${String(defaults.defaultProvider)}/${String(defaults.defaultModel)}` : undefined;
		lines.push(`- settings.json：${model ? `默认模型 ${model}` : Object.keys(defaults).join("、")}${defaults.defaultThinkingLevel ? `，思考强度 ${String(defaults.defaultThinkingLevel)}` : ""}`);
	}

	const piAuth = readJson(join(piDir, "auth.json")) as Record<string, Json>;
	const authPath = join(agentDir, "auth.json");
	const ourAuth = readJson(authPath) as Record<string, Json>;
	const copied: string[] = [];
	const needLogin: string[] = [];
	for (const [id, credential] of Object.entries(piAuth)) {
		if (id in ourAuth) continue;
		const key = typeof credential.key === "string" ? credential.key : "";
		if (credential.type === "api_key" && (key.startsWith("!") || /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(key))) {
			ourAuth[id] = credential;
			copied.push(id);
		} else {
			needLogin.push(id);
		}
	}
	if (copied.length > 0) writeJson(authPath, ourAuth);
	if (copied.length > 0) lines.push(`- auth.json：复制了引用型凭据（命令或环境变量）${copied.join("、")}`);
	if (needLogin.length > 0) {
		lines.push(`- 未复制 ${needLogin.join("、")} 的登录信息（密钥或 OAuth 令牌不留第二份）：在 2pi 中运行 /login 登录，或设置 TWOPI_USE_PI_CONFIG=1 直接共用 pi 的配置`);
	}
	if (copied.length === 0 && needLogin.length === 0) lines.push("- auth.json：没有需要处理的凭据");
	return lines;
}
