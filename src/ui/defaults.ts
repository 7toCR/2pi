import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * First-run settings for 2pi's own config directory: no list of loaded resources at startup,
 * thinking collapsed to one line, no page images in the transcript (the model still sees them),
 * and codex's retry budget for dropped streams (five tries, backoff from one second; see
 * core/reconnect.ts for what happens when the network is gone altogether). Each default is
 * applied once; anything the user changes later (e.g. with /settings) is kept.
 */
const DEFAULTS: Record<string, unknown> = {
	quietStartup: "header",
	hideThinkingBlock: true,
	showImages: false,
	retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000, maxAgentDelayMs: 60_000 },
};
/** The settings version that introduced each default: a later version only adds its own. */
const SINCE: Record<string, number> = { quietStartup: 1, hideThinkingBlock: 1, showImages: 1, retry: 2 };
const MARKER = "twopiUiDefaults";
const VERSION = 2;

function readSettings(agentDir: string): Record<string, unknown> | undefined {
	const path = join(agentDir, "settings.json");
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return undefined; // A settings file pi cannot read either is left for the user to fix.
	}
}

export function applyUiDefaults(agentDir: string): string[] {
	const settings = readSettings(agentDir);
	if (!settings) return [];
	const version = Number(settings[MARKER] ?? 0);
	if (version >= VERSION) return [];
	const applied = Object.keys(DEFAULTS).filter((key) => (SINCE[key] ?? 1) > version && settings[key] === undefined);
	for (const key of applied) settings[key] = DEFAULTS[key];
	settings[MARKER] = VERSION;
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	return applied;
}

/** pi's per-request retry budget as configured (pi's default is 3). */
export function retryBudget(agentDir: string): number {
	const retry = readSettings(agentDir)?.retry as { maxRetries?: unknown; enabled?: unknown } | undefined;
	if (retry?.enabled === false) return 0;
	return typeof retry?.maxRetries === "number" ? retry.maxRetries : 3;
}
