import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Root of the agent package (works from src/core/ and dist/core/). */
export const AGENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const AGENT_NAME = "2pi";
export const AGENT_TITLE = "2pi";
/** Environment variables cannot start with a digit, so 2pi's use this prefix. */
export const ENV_PREFIX = "TWOPI_";

/**
 * pi's process variables that 2pi reads under its own prefix (pi's `PI_CODING_AGENT_DIR` is
 * 2pi's `TWOPI_CODING_AGENT_DIR`): same meaning, only the name differs.
 */
export const PI_VARIABLES = [
	"CODING_AGENT_DIR",
	"CODING_AGENT_SESSION_DIR",
	"OFFLINE",
	"TELEMETRY",
	"CACHE_RETENTION",
	"HARDWARE_CURSOR",
	"HYPERLINKS",
	"PROGRAM_STATUS",
	"IMAGE_PROTOCOL",
	"TRUE_COLOR",
	"TUI_ESC_TIMEOUT",
	"SHARE_VIEWER_URL",
] as const;

export function env(name: string): string | undefined {
	const value = process.env[`${ENV_PREFIX}${name}`];
	return value?.trim() ? value : undefined;
}

/** Where 2pi keeps its own pi configuration, credentials, and sessions. */
export function getAgentHome(): string {
	return resolve(env("HOME") ?? join(homedir(), ".2pi"));
}

/**
 * A pack's skill is read in place, never copied, so improvements to the skill reach the agent
 * without a sync step. Order: explicit env var, the repository checkout, the vendored copy.
 */
export function resolveSkillDir(name: string, envName: string, candidates: string[]): string {
	const all = [env(envName), ...candidates].filter((value): value is string => !!value);
	for (const candidate of all) {
		if (existsSync(join(candidate, "SKILL.md"))) return resolve(candidate);
	}
	throw new Error(
		`找不到 ${name} skill（已尝试：${all.join("；")}）。请设置环境变量 ${ENV_PREFIX}${envName} 指向包含 SKILL.md 的目录。`,
	);
}

export interface PythonCommand {
	command: string;
	/** Leading arguments, e.g. `-3` for the Windows `py` launcher. */
	args: string[];
}

let cachedPython: PythonCommand | undefined;

/** First Python >= 3.9 found on this machine (override with TWOPI_PYTHON). */
export function resolvePython(): PythonCommand {
	if (cachedPython) return cachedPython;
	const explicit = env("PYTHON");
	const candidates: PythonCommand[] = explicit
		? [{ command: explicit, args: [] }]
		: process.platform === "win32"
			? [
					{ command: "python", args: [] },
					{ command: "py", args: ["-3"] },
					{ command: "python3", args: [] },
				]
			: [
					{ command: "python3", args: [] },
					{ command: "python", args: [] },
				];
	for (const candidate of candidates) {
		const probe = spawnSync(
			candidate.command,
			[...candidate.args, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)"],
			{ stdio: "ignore", windowsHide: true },
		);
		if (probe.status === 0) {
			cachedPython = candidate;
			return candidate;
		}
	}
	throw new Error(`未找到 Python 3.9+。请安装 Python，或设置环境变量 ${ENV_PREFIX}PYTHON 指向 python 可执行文件。`);
}
