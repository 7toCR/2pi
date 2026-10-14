import { resolve } from "node:path";
import { isInside, normalizePath } from "./paths.ts";

/**
 * Per-session state shared by the core and every pack. Pi recreates extensions when the session
 * is replaced, so this never leaks across sessions. Packs keep their own domain state.
 */
export class CoreState {
	/** Paths the agent must not modify: knowledge bases, the agent itself, source papers. */
	readonly readOnlyRoots: string[];
	/** Images the model has opened with `read`, for "look before you deliver" checks. */
	readonly viewedImages = new Set<string>();
	/** Files the agent created in this session; changing them again needs no confirmation. */
	readonly agentFiles = new Set<string>();
	/** Automatic fix rounds the end-of-turn gate started for the current user prompt. */
	nudges = 0;
	/** The last gate message, so an unchanged reminder is not repeated. */
	lastNudge = "";
	/** The user allowed online search for this session (when the project card does not). */
	onlineGranted = false;
	/** Ids of the packs the project in `cwd` uses; set by the extension once packs are known. */
	activePacks: (cwd: string) => string[] = () => [];

	constructor(readOnlyRoots: string[]) {
		this.readOnlyRoots = [...readOnlyRoots];
	}

	protect(path: string): void {
		if (!this.readOnlyRoots.some((root) => isInside(path, root))) this.readOnlyRoots.push(resolve(path));
	}

	markViewed(path: string): void {
		this.viewedImages.add(normalizePath(path));
	}

	hasViewed(path: string): boolean {
		return this.viewedImages.has(normalizePath(path));
	}

	markCreated(path: string): void {
		this.agentFiles.add(normalizePath(path));
	}

	isCreated(path: string): boolean {
		return this.agentFiles.has(normalizePath(path));
	}
}
