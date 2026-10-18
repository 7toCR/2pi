import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { ENV_PREFIX, env } from "./config.ts";

/**
 * Keys for the optional online services. /setup saves them in 2pi's config directory
 * (services.json, next to pi's auth.json); the TWOPI_ environment variable of the same name wins,
 * so scripts and CI keep working as before. Read on every use, so a change applies at once.
 */

export const SERVICE_KEYS = ["OPENALEX_KEY", "EPO_OPS_KEY", "EPO_OPS_SECRET"] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const SERVICES_FILE = "services.json";

export function servicesPath(agentDir = getAgentDir()): string {
	return join(agentDir, SERVICES_FILE);
}

function readSaved(agentDir?: string): Partial<Record<ServiceKey, string>> {
	try {
		const path = servicesPath(agentDir);
		if (!existsSync(path)) return {};
		const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const saved: Partial<Record<ServiceKey, string>> = {};
		for (const name of SERVICE_KEYS) {
			const value = data[name];
			if (typeof value === "string" && value.trim()) saved[name] = value.trim();
		}
		return saved;
	} catch {
		return {};
	}
}

/** The key in effect: TWOPI_<name> when set, else the one /setup saved. */
export function serviceKey(name: ServiceKey, agentDir?: string): string | undefined {
	return env(name) ?? readSaved(agentDir)[name];
}

/** Where the key in effect comes from, for status lines. */
export function serviceKeySource(name: ServiceKey, agentDir?: string): "env" | "saved" | undefined {
	if (env(name)) return "env";
	return readSaved(agentDir)[name] ? "saved" : undefined;
}

/** Save (or with an empty value, remove) keys. Other entries in the file are kept. */
export function saveServiceKeys(values: Partial<Record<ServiceKey, string | undefined>>, agentDir = getAgentDir()): string {
	const path = servicesPath(agentDir);
	let data: Record<string, unknown> = {};
	try {
		if (existsSync(path)) data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		data = {};
	}
	for (const [name, value] of Object.entries(values)) {
		if (value?.trim()) data[name] = value.trim();
		else delete data[name];
	}
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	// mode applies only when the file is created; tighten an existing one too (no-op on Windows).
	try {
		chmodSync(path, 0o600);
	} catch {
		// not supported here
	}
	return path;
}

/** "abcd…wxyz": enough to recognise a key, not enough to reuse it. */
export function maskKey(value: string): string {
	return value.length <= 8 ? "•".repeat(value.length) : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** One status phrase: "已保存 abcd…wxyz", "环境变量 TWOPI_X", "未配置". */
export function describeKey(name: ServiceKey, agentDir?: string): string {
	const value = serviceKey(name, agentDir);
	const source = serviceKeySource(name, agentDir);
	if (!value || !source) return "未配置";
	return source === "env" ? `环境变量 ${ENV_PREFIX}${name}（${maskKey(value)}）` : `已保存（${maskKey(value)}）`;
}
