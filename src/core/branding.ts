import { AGENT_NAME, ENV_PREFIX, PI_VARIABLES } from "./config.ts";

/**
 * pi's own help and messages under 2pi's names. 2pi runs pi's CLI unchanged, so `2pi --help`,
 * `2pi auth --help` and the like print pi's text; only the names differ: the command, the config
 * directory and the environment variables 2pi reads under its own prefix.
 */
export function rebrandPiText(text: string): string {
	let out = text
		// pi's one-line title (bold "pi - AI coding assistant ..."): 2pi prints its own above.
		.replace(/^.* - AI coding assistant with read, bash, edit, write tools.*(\r?\n)+/m, "")
		// Command lines: "  pi install <source>", "pi auth print-api-key", "  pi" alone.
		.replace(/^(\s*)pi(?=\s|$)/gm, `$1${AGENT_NAME}`)
		.replace(/(`)pi(?=[\s`])/g, `$1${AGENT_NAME}`)
		.replace(/~\/\.pi\/agent/g, `~/.${AGENT_NAME}/agent`);
	const longer = ENV_PREFIX.length - "PI_".length;
	for (const name of PI_VARIABLES) {
		// In aligned tables the longer name takes its room from the padding after it.
		out = out.replace(new RegExp(`\\bPI_${name}\\b( *)`, "g"), (_match, pad: string) =>
			`${ENV_PREFIX}${name}${pad.length > longer ? pad.slice(longer) : pad}`,
		);
	}
	return out;
}

/**
 * Whether `2pi update ...` would update pi itself (its default target): 2pi is updated from its
 * own repository, so only extension and model-catalog updates go through to pi.
 */
export function isSelfUpdate(args: string[]): boolean {
	if (args[0] !== "update") return false;
	const rest = args.slice(1);
	if (rest.includes("--help") || rest.includes("-h")) return false;
	if (rest.some((arg) => arg === "--self" || arg === "--all")) return true;
	if (rest.some((arg) => arg === "--models" || arg === "--extensions" || arg === "--extension")) return false;
	const source = rest.find((arg) => !arg.startsWith("-"));
	return source === undefined || source === "self" || source === "pi";
}
