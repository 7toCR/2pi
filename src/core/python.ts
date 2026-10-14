import { spawn } from "node:child_process";
import { resolvePython } from "./config.ts";

export interface PythonResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

export interface RunPythonOptions {
	cwd: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/** Run a Python script with UTF-8 I/O and collect its output. Never rejects for a non-zero exit. */
export function runPython(script: string, args: string[], options: RunPythonOptions): Promise<PythonResult> {
	const python = resolvePython();
	return new Promise((resolvePromise, reject) => {
		const child = spawn(python.command, [...python.args, script, ...args], {
			cwd: options.cwd,
			env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
		});
		const kill = () => child.kill();
		options.signal?.addEventListener("abort", kill, { once: true });
		const timer = setTimeout(kill, options.timeoutMs ?? 600_000);
		child.on("error", (error) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", kill);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", kill);
			if (options.signal?.aborted) {
				reject(new Error("已取消"));
				return;
			}
			resolvePromise({ code, stdout, stderr });
		});
	});
}

/** Keep the head and tail of long tool output so the model sees both the summary and the errors. */
export function clip(text: string, maxChars = 12_000): string {
	if (text.length <= maxChars) return text;
	const half = Math.floor(maxChars / 2);
	return `${text.slice(0, half)}\n…（中间省略 ${text.length - maxChars} 个字符）…\n${text.slice(-half)}`;
}
