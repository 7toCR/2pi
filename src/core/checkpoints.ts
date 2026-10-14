import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureStateDir, STATE_DIR } from "./project.ts";

/**
 * File checkpoints in a shadow git repository (`.2pi/history`, work tree = the project). The
 * user's own git repository is never touched: GIT_DIR is always explicit, and `.2pi/` ignores
 * itself. Each agent turn becomes a commit, so any two turns can be compared or undone.
 */

export interface FileChange {
	path: string;
	status: "added" | "modified" | "deleted";
	additions: number;
	deletions: number;
	binary: boolean;
}

export interface CheckpointEntry {
	commit: string;
	time: number;
	message: string;
}

/** Derived or bulky output that a checkpoint should not carry. */
const EXCLUDES = [
	`/${STATE_DIR}/`,
	".git/",
	"node_modules/",
	"__pycache__/",
	"**/build/",
	"**/preview/",
	"**/*_preview/",
	"~$*",
	".DS_Store",
	"Thumbs.db",
];
const SKIPPED_DIRS = new Set([STATE_DIR, ".git", "node_modules", "__pycache__", "build", "preview"]);
/** Above these, the directory is not a drafting project (e.g. a home folder): checkpoints stay off. */
export const MAX_FILES = 5000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function countFiles(dir: string, limit: number): number {
	let count = 0;
	const walk = (path: string) => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			if (count > limit) return;
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRS.has(entry.name)) walk(join(path, entry.name));
			} else {
				count++;
			}
		}
	};
	walk(dir);
	return count;
}

export class Checkpoints {
	readonly cwd: string;
	readonly gitDir: string;
	private state: "unknown" | "on" | "off" = "unknown";
	disabledReason?: string;

	constructor(cwd: string) {
		this.cwd = cwd;
		this.gitDir = join(cwd, STATE_DIR, "history");
	}

	private git(args: string[]): { ok: boolean; status: number | null; stdout: string; stderr: string } {
		const result = spawnSync(
			"git",
			["-c", "core.quotepath=false", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...args],
			{
				cwd: this.cwd,
				env: { ...process.env, GIT_DIR: this.gitDir, GIT_WORK_TREE: this.cwd, GIT_OPTIONAL_LOCKS: "0" },
				encoding: "utf8",
				windowsHide: true,
				maxBuffer: 64 * 1024 * 1024,
			},
		);
		return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
	}

	private disable(reason: string): false {
		this.state = "off";
		this.disabledReason = reason;
		return false;
	}

	/** Create the shadow repository on first use. False (with a reason) when checkpoints are off. */
	ensure(): boolean {
		if (this.state !== "unknown") return this.state === "on";
		if (spawnSync("git", ["--version"], { stdio: "ignore", windowsHide: true }).status !== 0) {
			return this.disable("未找到 git，检查点与 /undo 不可用");
		}
		if (!existsSync(join(this.gitDir, "HEAD"))) {
			const files = countFiles(this.cwd, MAX_FILES);
			if (files > MAX_FILES) {
				return this.disable(`工作目录文件超过 ${MAX_FILES} 个，不像是一个写作项目，检查点已关闭；请在专门的项目目录中运行 2pi`);
			}
			ensureStateDir(this.cwd);
			mkdirSync(this.gitDir, { recursive: true });
			if (!this.git(["init", "--quiet"]).ok) return this.disable("无法初始化检查点仓库");
			for (const [key, value] of [
				["user.name", "2pi"],
				["user.email", "2pi@localhost"],
				["commit.gpgsign", "false"],
				// A path that never exists: the user's global hooks must not run on checkpoint commits.
				["core.hooksPath", join(this.gitDir, "no-hooks")],
			]) {
				this.git(["config", key, value]);
			}
			mkdirSync(join(this.gitDir, "info"), { recursive: true });
			writeFileSync(join(this.gitDir, "info", "exclude"), `${EXCLUDES.join("\n")}\n`, "utf8");
		}
		this.state = "on";
		return true;
	}

	head(): string | undefined {
		const result = this.git(["rev-parse", "--verify", "--quiet", "HEAD"]);
		return result.ok ? result.stdout.trim() : undefined;
	}

	/** Large new files (datasets, videos) are left out instead of bloating every checkpoint. */
	private excludeLargeFiles(): void {
		const untracked = this.git(["ls-files", "--others", "--exclude-standard", "-z"]).stdout.split("\0").filter(Boolean);
		const large = untracked.filter((path) => {
			try {
				return statSync(join(this.cwd, path)).size > MAX_FILE_BYTES;
			} catch {
				return false;
			}
		});
		if (large.length > 0) appendFileSync(join(this.gitDir, "info", "exclude"), large.map((p) => `/${p}\n`).join(""));
	}

	/** Commit the work tree if it changed. Returns the current checkpoint, or undefined when off. */
	snapshot(message: string): string | undefined {
		if (!this.ensure()) return undefined;
		this.excludeLargeFiles();
		if (!this.git(["add", "-A"]).ok) return this.head();
		const head = this.head();
		if (head && this.git(["diff", "--cached", "--quiet"]).ok) return head;
		const commit = this.git(["commit", "--quiet", "--allow-empty", "--no-verify", "-m", message]);
		return commit.ok ? this.head() : head;
	}

	/** A file's content at a checkpoint, or undefined when it did not exist there. */
	readAt(commit: string, path: string): Buffer | undefined {
		const result = spawnSync("git", ["show", `${commit}:${path}`], {
			cwd: this.cwd,
			env: { ...process.env, GIT_DIR: this.gitDir, GIT_WORK_TREE: this.cwd, GIT_OPTIONAL_LOCKS: "0" },
			windowsHide: true,
			maxBuffer: 256 * 1024 * 1024,
		});
		return result.status === 0 ? result.stdout : undefined;
	}

	/** Files under `dir` (relative, forward slashes) at a checkpoint. */
	listAt(commit: string, dir: string): string[] {
		return this.git(["ls-tree", "-r", "--name-only", "-z", commit, "--", dir]).stdout.split("\0").filter(Boolean);
	}

	/** What changed in the work tree since a checkpoint, without committing (stages to the shadow index only). */
	diffToWorktree(from: string): FileChange[] {
		if (!this.ensure()) return [];
		this.excludeLargeFiles();
		this.git(["add", "-A"]);
		return this.diff(from, "--cached");
	}

	diff(from: string, to: string): FileChange[] {
		// `to` may be "--cached": compare `from` with the shadow index (the staged work tree).
		const range = to === "--cached" ? ["--cached", from] : [from, to];
		const names = this.git(["diff", "--name-status", "--no-renames", "-z", ...range]).stdout.split("\0");
		const statuses = new Map<string, FileChange["status"]>();
		for (let i = 0; i + 1 < names.length; i += 2) {
			const code = names[i] ?? "";
			const path = names[i + 1] ?? "";
			if (!path) continue;
			statuses.set(path, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified");
		}
		const changes: FileChange[] = [];
		for (const record of this.git(["diff", "--numstat", "--no-renames", "-z", ...range]).stdout.split("\0")) {
			const match = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(record);
			if (!match) continue;
			const path = match[3] ?? "";
			changes.push({
				path,
				status: statuses.get(path) ?? "modified",
				additions: match[1] === "-" ? 0 : Number(match[1]),
				deletions: match[2] === "-" ? 0 : Number(match[2]),
				binary: match[1] === "-",
			});
		}
		return changes.sort((a, b) => a.path.localeCompare(b.path));
	}

	/** Unified diff of text files between two checkpoints, for display. */
	patch(from: string, to: string, paths: string[] = []): string {
		return this.git(["diff", "--no-renames", "--no-color", from, to, "--", ...paths]).stdout;
	}

	log(limit = 20): CheckpointEntry[] {
		if (!this.ensure() || !this.head()) return [];
		return this.git(["log", `-n${limit}`, "--format=%h%x1f%ct%x1f%s"])
			.stdout.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => {
				const [commit = "", time = "0", message = ""] = line.split("\x1f");
				return { commit, time: Number(time) * 1000, message };
			});
	}

	private blobAt(commit: string, path: string): string | undefined {
		const result = this.git(["rev-parse", "--verify", "--quiet", `${commit}:${path}`]);
		return result.ok ? result.stdout.trim() : undefined;
	}

	private currentBlob(path: string): string | undefined {
		if (!existsSync(join(this.cwd, path))) return undefined;
		const result = this.git(["hash-object", "--", path]);
		return result.ok ? result.stdout.trim() : undefined;
	}

	/**
	 * Put the files a turn changed back to their state before the turn. Files edited again after
	 * the turn are conflicts: they are left alone unless `force` is set.
	 */
	revert(before: string, after: string, files: FileChange[], force = false): { restored: string[]; conflicts: string[] } {
		const conflicts = files
			.filter((file) => this.currentBlob(file.path) !== (file.status === "deleted" ? undefined : this.blobAt(after, file.path)))
			.map((file) => file.path);
		if (conflicts.length > 0 && !force) return { restored: [], conflicts };
		const restored: string[] = [];
		for (const file of files) {
			if (file.status === "added") {
				rmSync(join(this.cwd, file.path), { force: true });
			} else if (!this.git(["checkout", before, "--", file.path]).ok) {
				continue;
			}
			restored.push(file.path);
		}
		return { restored, conflicts };
	}
}
