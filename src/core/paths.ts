import { resolve } from "node:path";

/** Forward slashes keep paths readable and copyable for the model on every platform. */
export const slash = (path: string): string => path.replace(/\\/g, "/");

/** Normalize for comparisons: absolute, forward slashes, case-insensitive on Windows. */
export function normalizePath(path: string): string {
	const absolute = slash(resolve(path));
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

/** Models sometimes pass pi's `@file` mention syntax as a path. */
export function cleanPathArg(path: string): string {
	return path.trim().replace(/^@/, "").replace(/^["']|["']$/g, "");
}

export function isInside(child: string, parent: string): boolean {
	const c = normalizePath(child);
	const p = normalizePath(parent).replace(/\/$/, "");
	return c === p || c.startsWith(`${p}/`);
}

/** Split command arguments on whitespace, keeping "quoted paths with spaces" together. */
export function splitArgs(args: string): string[] {
	return [...args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}
