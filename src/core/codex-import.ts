import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * `2pi import-codex`: configure 2pi's model from the user's codex setup (config.toml provider,
 * model catalog, auth.json), written the way pi itself is configured, so `/model`, `/login`,
 * `/logout` and `2pi auth check` treat it like any other provider:
 *
 * - models.json: the provider under codex's own id and name (e.g. `superaihub`), with pi's model
 *   fields (context window, input types, thinking levels from codex's model catalog).
 * - auth.json: an `api_key` credential whose key is a `!command`. pi runs it once per process and
 *   caches the result; the command reads codex's env_key variable, else codex's auth.json, so 2pi
 *   never stores a copy of the key. A credential the user already stored (e.g. with /login) is kept.
 * - settings.json: defaultProvider, defaultModel, defaultThinkingLevel.
 */

type Toml = { top: Record<string, unknown>; tables: Record<string, Record<string, unknown>> };

function parseValue(raw: string): unknown {
	const value = raw.trim();
	if (value.startsWith('"')) {
		const match = /^"((?:[^"\\]|\\.)*)"/.exec(value);
		return match ? JSON.parse(`"${match[1]}"`) : undefined;
	}
	if (value.startsWith("'")) return /^'([^']*)'/.exec(value)?.[1];
	if (value === "true" || value === "false") return value === "true";
	const number = Number(value.replace(/#.*$/, "").trim().replace(/_/g, ""));
	return Number.isFinite(number) ? number : undefined;
}

/** Enough TOML for codex's config.toml: scalar keys in the root and in `[a.b]` tables. */
export function parseCodexToml(text: string): Toml {
	const result: Toml = { top: {}, tables: {} };
	let current = result.top;
	let depth = 0;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (depth > 0) {
			// Inside a multi-line array value: skip until its brackets balance.
			depth += (line.match(/\[/g)?.length ?? 0) - (line.match(/\]/g)?.length ?? 0);
			continue;
		}
		if (!line || line.startsWith("#")) continue;
		const header = /^\[([^\[\]]+)\]$/.exec(line);
		if (header) {
			const name = (header[1] ?? "").trim().replace(/["']/g, "");
			current = result.tables[name] ??= {};
			continue;
		}
		const pair = /^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(line);
		if (!pair) continue;
		const key = (pair[1] ?? "").replace(/"/g, "");
		const raw = pair[2] ?? "";
		if (raw.startsWith("[") || raw.startsWith("{")) {
			depth = (raw.match(/[[{]/g)?.length ?? 0) - (raw.match(/[\]}]/g)?.length ?? 0);
			continue;
		}
		current[key] = parseValue(raw);
	}
	return result;
}

const PI_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type PiLevel = (typeof PI_LEVELS)[number];

/** Codex effort names and common spellings to pi thinking levels. */
export function toPiThinkingLevel(value: string | undefined): PiLevel | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
	const aliases: Record<string, PiLevel> = {
		none: "off",
		off: "off",
		minimal: "minimal",
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh",
		extrahigh: "xhigh",
		veryhigh: "xhigh",
		max: "max",
		maximum: "max",
		ultra: "max",
	};
	return aliases[normalized];
}

interface CatalogEntry {
	slug?: string;
	display_name?: string;
	context_window?: number;
	input_modalities?: string[];
	supported_reasoning_levels?: Array<{ effort?: string }>;
}

function catalogEntry(catalogPath: string | undefined, model: string): CatalogEntry | undefined {
	if (!catalogPath || !existsSync(catalogPath)) return undefined;
	const data = JSON.parse(readFileSync(catalogPath, "utf8")) as { models?: CatalogEntry[] } | CatalogEntry[];
	const models = Array.isArray(data) ? data : (data.models ?? []);
	return models.find((entry) => entry.slug === model);
}

/** pi model definition for a codex model; levels codex does not list are marked unsupported. */
export function piModelDefinition(
	model: string,
	entry: CatalogEntry | undefined,
): { id: string; [key: string]: unknown } {
	const efforts = new Set(
		(entry?.supported_reasoning_levels ?? [])
			.map((level) => toPiThinkingLevel(level.effort))
			.filter((level): level is PiLevel => !!level),
	);
	const thinkingLevelMap: Record<string, string | null> = {};
	for (const level of PI_LEVELS) {
		if (efforts.size === 0) break;
		thinkingLevelMap[level] = efforts.has(level) ? (level === "off" ? "none" : level) : null;
	}
	if (efforts.size === 0) Object.assign(thinkingLevelMap, { xhigh: "xhigh" });
	const input = (entry?.input_modalities ?? ["text", "image"]).filter((kind) => kind === "text" || kind === "image");
	return {
		id: model,
		name: entry?.display_name ?? model,
		reasoning: true,
		thinkingLevelMap,
		input: input.length > 0 ? input : ["text"],
		contextWindow: entry?.context_window ?? 272_000,
		maxTokens: 128_000,
	};
}

function readJson(path: string): Record<string, unknown> {
	return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
}

function writeJson(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export interface ImportOptions {
	agentDir: string;
	codexHome?: string;
	model?: string;
	thinking?: string;
	/** Provider id in models.json; defaults to the codex provider's name. */
	providerId?: string;
}

/** A provider id pi accepts in models.json and model references (`id/model`). */
export function providerIdFor(key: string): string {
	const id = key.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return id || "codex";
}

/**
 * The shell command (pi's `!command` key syntax) that prints codex's API key: the provider's
 * env_key variable when set, else OPENAI_API_KEY from codex's auth.json. No `$` and no double
 * quotes inside, so bash, cmd and PowerShell all run it unchanged.
 */
export function codexKeyCommand(envKey: string | undefined): string {
	const fromEnv = envKey && /^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey) ? `e['${envKey}']||` : "";
	const script = [
		"const e=process.env",
		"const p=require('path')",
		"const f=p.join(e.CODEX_HOME||p.join(require('os').homedir(),'.codex'),'auth.json')",
		`process.stdout.write(${fromEnv}(require('fs').existsSync(f)?JSON.parse(require('fs').readFileSync(f,'utf8')).OPENAI_API_KEY||'':''))`,
	].join(";");
	return `!node -e "${script}"`;
}

type ModelsFile = { providers?: Record<string, Record<string, unknown> & { models?: Array<{ id: string }> }> };
type AuthFile = Record<string, { type?: string; key?: string } & Record<string, unknown>>;

export function importCodexConfig(options: ImportOptions): string[] {
	const codexHome = resolve(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"));
	const configPath = join(codexHome, "config.toml");
	if (!existsSync(configPath)) throw new Error(`找不到 ${configPath}`);
	const toml = parseCodexToml(readFileSync(configPath, "utf8"));
	const providerKey = String(toml.top.model_provider ?? "openai");
	const provider = toml.tables[`model_providers.${providerKey}`];
	const model = options.model ?? (typeof toml.top.model === "string" ? toml.top.model : undefined);
	if (!model) throw new Error("没有指定模型：请用 --model，或在 codex config.toml 中设置 model。");

	const baseUrl = String(provider?.base_url ?? "https://api.openai.com/v1").replace(/\/+$/, "");
	const wireApi = String(provider?.wire_api ?? "responses");
	const api = wireApi === "chat" ? "openai-completions" : "openai-responses";
	const envKey = typeof provider?.env_key === "string" ? provider.env_key : undefined;

	const catalogPath = typeof toml.top.model_catalog_json === "string" ? toml.top.model_catalog_json : undefined;
	const entry = catalogEntry(catalogPath, model);
	const definition = piModelDefinition(model, entry);
	// Without the catalog's reasoning levels nothing is known to be unsupported.
	const known = (entry?.supported_reasoning_levels ?? []).length > 0;
	const levels = known
		? Object.entries((definition.thinkingLevelMap ?? {}) as Record<string, string | null>)
				.filter(([, value]) => value !== null)
				.map(([level]) => level)
		: [];
	const thinking =
		toPiThinkingLevel(options.thinking) ??
		toPiThinkingLevel(typeof toml.top.model_reasoning_effort === "string" ? toml.top.model_reasoning_effort : undefined) ??
		"high";
	if (options.thinking && !toPiThinkingLevel(options.thinking)) {
		throw new Error(`无法识别的思考强度：${options.thinking}（可用：${PI_LEVELS.join("、")}）`);
	}
	if (levels.length > 0 && !levels.includes(thinking)) {
		throw new Error(`${model} 不支持思考强度 ${thinking}（支持：${levels.join("、")}）`);
	}

	// Named like pi users name it (the provider's display name, e.g. "superaihub"); codex's own
	// key is often just "custom". Without a provider table codex uses OpenAI's built-in one.
	const providerId = providerIdFor(options.providerId ?? (provider ? String(provider.name ?? providerKey) : "codex"));
	const providerName = String(provider?.name ?? providerKey);
	const modelsPath = join(options.agentDir, "models.json");
	const models = readJson(modelsPath) as ModelsFile;
	const existing = models.providers?.[providerId];
	const previous = existing?.models ?? [];
	// Keep what the user added to the provider by hand (headers, compat, other models).
	const { apiKey: legacyKey, ...kept } = existing ?? {};
	models.providers = {
		...models.providers,
		[providerId]: {
			...kept,
			name: providerName,
			baseUrl,
			api,
			models: [...previous.filter((item) => item.id !== model), definition],
		},
	};
	writeJson(modelsPath, models);

	// The credential goes where /login puts credentials, unless one is already stored there.
	const authPath = join(options.agentDir, "auth.json");
	const auth = readJson(authPath) as AuthFile;
	const stored = auth[providerId];
	const usesLegacyScript = typeof stored?.key === "string" && stored.key.includes("codex-api-key.mjs");
	const keyLine = stored && !usesLegacyScript
		? `API Key：保留 auth.json 中已有的 ${providerId} 凭据（/logout 可删除后重新导入）`
		: `API Key：auth.json 中的 ${providerId} 凭据是一条命令，首次请求时读取${envKey ? `环境变量 ${envKey}，没有时读取` : ""} ${join(codexHome, "auth.json")}，2pi 不保存密钥副本`;
	if (!stored || usesLegacyScript) {
		auth[providerId] = { type: "api_key", key: codexKeyCommand(envKey) };
		writeJson(authPath, auth);
	}

	const settingsPath = join(options.agentDir, "settings.json");
	writeJson(settingsPath, {
		...readJson(settingsPath),
		defaultProvider: providerId,
		defaultModel: model,
		defaultThinkingLevel: thinking,
	});

	// Earlier 2pi versions wrote a "codex" provider that ran a script from the 2pi checkout.
	const legacy = Object.entries(models.providers)
		.filter(([id, value]) => id !== providerId && String(value.apiKey ?? "").includes("codex-api-key.mjs"))
		.map(([id]) => id);

	return [
		`已从 ${codexHome} 导入：provider「${providerName}」${baseUrl}（${api}）`,
		`模型：${providerId}/${model}，上下文 ${String(definition.contextWindow)}，输入 ${(definition.input as string[]).join("+")}${entry ? "" : "（codex 模型目录中没有该模型，使用默认参数）"}`,
		`思考强度：${thinking}（支持：${levels.join("、") || "未知"}）`,
		keyLine,
		...(legacyKey !== undefined ? ["models.json 中该 provider 原有的 apiKey 已移除，凭据统一放在 auth.json"] : []),
		...(legacy.length > 0 ? [`旧版 2pi 导入的 provider ${legacy.join("、")} 仍在 models.json 中，不再需要时可以删除`] : []),
		`已写入：${modelsPath}`,
		`已写入：${authPath}`,
		`已写入：${settingsPath}`,
	];
}
