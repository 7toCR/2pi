import { statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { env } from "./config.ts";

/** Locate an executable on PATH (with PATHEXT on Windows) without spawning a shell. */
export function which(name: string): string | undefined {
	const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const ext of exts) {
			for (const path of [join(dir, name + ext.toLowerCase()), join(dir, name + ext)]) {
				try {
					if (statSync(path).isFile()) return path;
				} catch {
					// not here
				}
			}
		}
	}
	return undefined;
}

/** An external program: TWOPI_<NAME> when set, else the first of `names` on PATH. */
export function tool(envName: string, ...names: string[]): string | undefined {
	return env(envName) ?? names.map(which).find((path): path is string => !!path);
}
