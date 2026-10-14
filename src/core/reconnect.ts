import { connect } from "node:net";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { env } from "./config.ts";

/**
 * Reconnecting after a dropped connection, modelled on codex (codex-rs/core/src/responses_retry.rs):
 *
 * 1. Transient failures (rate limits, 5xx, a stream that breaks off) are retried a bounded number
 *    of times with exponential backoff. pi already does this per request (`retry` in settings.json);
 *    2pi's first-run defaults raise its budget to codex's five stream retries (ui/defaults.ts).
 * 2. When the connection itself is gone (DNS fails, connection refused or reset), codex stops
 *    counting and waits for the network: "Reconnecting... waiting for network", 5 s doubling to
 *    60 s. pi gives up after its retries; 2pi takes over at that point (`agent_before_settle` with
 *    an error outcome), keeps the run open, probes the provider's host (or the proxy) with a TCP
 *    connect, and once it answers drops the failed attempt from the context and continues the turn
 *    where it stopped. Esc cancels the wait. Interactive sessions wait as long as it takes, like
 *    codex; headless runs give up after TWOPI_RECONNECT_MAX_WAIT minutes (default 10).
 * 3. Failures that waiting cannot fix (quota, billing, authentication, an invalid request) end
 *    the run at once.
 */

/** Errors that mean the connection to the provider failed, not that the provider refused. */
const CONNECTION_ERROR =
	/fetch failed|network.?error|connection.?(error|refused|lost|reset|closed)|other side closed|socket hang up|socket connection was closed|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EHOSTDOWN|ENOTFOUND|EAI_AGAIN|getaddrinfo|upstream.?connect|reset before headers|terminated|timed? out|timeout|websocket.?(closed|error)|ended without|stream ended before|did not get a response|pending stream has been canceled|UND_ERR/i;
/** Errors no amount of waiting fixes. */
const PERMANENT_ERROR =
	/insufficient_quota|quota|billing|usage.?limit|out of budget|unauthori[sz]ed|forbidden|invalid.?(api.?key|request|x-api-key)|authentication|permission|\b(400|401|402|403|404|413|422)\b|context.?(length|window)|too long|maximum context/i;

export type NetworkFailure = "connection" | "permanent" | "other";

export function classifyNetworkError(message: string | undefined): NetworkFailure {
	if (!message) return "other";
	if (PERMANENT_ERROR.test(message)) return "permanent";
	return CONNECTION_ERROR.test(message) ? "connection" : "other";
}

/** codex's connection backoff: 5 s, doubling, at most 60 s, with ±10% jitter. */
export function offlineDelayMs(attempt: number, random: () => number = Math.random): number {
	const base = Math.min(60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
	return Math.round(base * (0.9 + random() * 0.2));
}

export interface ProbeTarget {
	host: string;
	port: number;
	/** "proxy" when requests go through HTTP(S)_PROXY. */
	via: "direct" | "proxy";
}

function proxyUrl(): string | undefined {
	for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]) {
		const value = process.env[name]?.trim();
		if (value) return value;
	}
	return undefined;
}

/** Where to probe: the proxy when one is configured, else the model's API host. */
export function probeTarget(baseUrl: string | undefined): ProbeTarget | undefined {
	const proxy = proxyUrl();
	for (const [raw, via] of [
		[proxy, "proxy"],
		[baseUrl, "direct"],
	] as const) {
		if (!raw) continue;
		try {
			const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
			const port = Number(url.port) || (url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80);
			if (url.hostname) return { host: url.hostname.replace(/^\[|\]$/g, ""), port, via };
		} catch {
			// An unparsable URL: try the next candidate.
		}
	}
	return undefined;
}

/** Whether a TCP connection to the target opens within `timeoutMs`. */
export function tcpProbe(target: ProbeTarget, timeoutMs = 4000): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ host: target.host, port: target.port });
		const done = (ok: boolean) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(timeoutMs, () => done(false));
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
	});
}

export interface ReconnectStatus {
	phase: "retry" | "offline";
	attempt: number;
	max?: number;
	nextAt?: number;
	error?: string;
}

export interface ReconnectOptions {
	/** Progress for the UI; undefined when the connection is back or the wait ended. */
	onStatus?: (status: ReconnectStatus | undefined) => void;
	/** pi's own retry budget, to show "2/5" while pi retries. */
	retryBudget?: () => number;
	probe?: (target: ProbeTarget) => Promise<boolean>;
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
	now?: () => number;
	random?: () => number;
}

/** Resumes in a row without a single successful response before 2pi stops trying. */
export const MAX_RESUMES = 5;

function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done, { once: true });
	});
}

function headlessLimitMs(): number {
	const minutes = Number(env("RECONNECT_MAX_WAIT") ?? 10);
	return Number.isFinite(minutes) && minutes >= 0 ? minutes * 60_000 : 10 * 60_000;
}

/** The parts of a session message the reconnect logic reads. */
interface MessageLike {
	role: string;
	stopReason?: string;
	errorMessage?: string;
}

interface FailedAttempt {
	entryId: string;
	errorMessage: string;
}

/** The failed response that ended the run, if the run ended on one. */
function failedAttempt(entries: ReadonlyArray<{ sourceEntry: { id: string; type: string; message?: unknown } }>): FailedAttempt | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const source = entries[index]?.sourceEntry;
		if (source?.type !== "message" || !source.message) continue;
		const message = source.message as MessageLike;
		if (message.role !== "assistant") continue;
		return message.stopReason === "error" ? { entryId: source.id, errorMessage: message.errorMessage ?? "" } : undefined;
	}
	return undefined;
}

function shortError(message: string): string {
	const flat = message.replace(/\s+/g, " ").trim();
	return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

export function installReconnect(pi: ExtensionAPI, options: ReconnectOptions = {}): void {
	const probe = options.probe ?? ((target: ProbeTarget) => tcpProbe(target));
	const sleep = options.sleep ?? sleepFor;
	const now = options.now ?? Date.now;
	const report = (status: ReconnectStatus | undefined) => options.onStatus?.(status);
	let resumes = 0;
	let failuresInRow = 0;

	pi.on("before_agent_start", () => {
		resumes = 0;
		failuresInRow = 0;
	});

	// While pi retries on its own: count the failures so the UI can say "重连中 2/5".
	pi.on("message_end", (event) => {
		const message = event.message as MessageLike;
		if (message.role !== "assistant") return;
		if (message.stopReason === "error") {
			failuresInRow += 1;
			if (classifyNetworkError(message.errorMessage) === "connection") {
				report({ phase: "retry", attempt: failuresInRow, max: options.retryBudget?.(), error: message.errorMessage });
			}
		} else {
			if (failuresInRow > 0) report(undefined);
			failuresInRow = 0;
			resumes = 0;
		}
	});

	pi.on("agent_before_settle", async (event, ctx) => {
		if (event.outcome !== "error") return undefined;
		const failed = failedAttempt(event.context.contextEntries as never);
		if (!failed || classifyNetworkError(failed.errorMessage) !== "connection") {
			report(undefined);
			return undefined;
		}
		if (resumes >= MAX_RESUMES) {
			report(undefined);
			notify(ctx, `网络探测已恢复，但连续 ${MAX_RESUMES} 次续跑仍然失败（${shortError(failed.errorMessage)}）。请检查代理或服务地址后重新发送。`, "error");
			return undefined;
		}
		const resumed = await waitForNetwork(ctx, failed.errorMessage);
		if (!resumed) {
			report(undefined);
			return undefined;
		}
		resumes += 1;
		failuresInRow = 0;
		report(undefined);
		notify(ctx, "网络已恢复，继续刚才中断的工作。", "info");
		return {
			// Drop the failed attempt, as pi does before its own retries, so the turn can continue.
			entries: [...event.entries, { type: "context_edit" as const, targetId: failed.entryId, replacement: null }],
			continue: true,
		};
	});

	async function waitForNetwork(ctx: ExtensionContext, errorMessage: string): Promise<boolean> {
		const target = probeTarget(ctx.model?.baseUrl);
		const cancel = new AbortController();
		const unsubscribe: Array<() => void> = [];
		if (ctx.signal) {
			const onAbort = () => cancel.abort();
			ctx.signal.addEventListener("abort", onAbort, { once: true });
			unsubscribe.push(() => ctx.signal?.removeEventListener("abort", onAbort));
		}
		if (ctx.mode === "tui") {
			// pi's Esc/Ctrl+C handling aborts the run; the wait has to notice and end too.
			unsubscribe.push(
				ctx.ui.onTerminalInput((data) => {
					if (data === "\x1b" || data === "\x03") cancel.abort();
					return undefined;
				}),
			);
		}
		const limit = ctx.mode === "tui" ? Number.POSITIVE_INFINITY : headlessLimitMs();
		const started = now();
		try {
			for (let attempt = 1; ; attempt++) {
				const delay = offlineDelayMs(attempt, options.random);
				if (now() - started + delay > limit) {
					notify(ctx, `网络在 ${Math.round(limit / 60_000)} 分钟内没有恢复，已停止等待（${shortError(errorMessage)}）。`, "error");
					return false;
				}
				const nextAt = now() + delay;
				report({ phase: "offline", attempt, nextAt, error: errorMessage });
				const where = target ? `${target.via === "proxy" ? "代理 " : ""}${target.host}:${target.port}` : "服务";
				if (ctx.hasUI) ctx.ui.setWorkingMessage(`连接中断，等待网络恢复 · 第 ${attempt} 次探测 ${where} · Esc 取消`);
				if (ctx.mode === "print" || ctx.mode === "json") {
					process.stderr.write(`2pi: 连接中断（${shortError(errorMessage)}），${Math.round(delay / 1000)} 秒后第 ${attempt} 次探测 ${where}\n`);
				}
				await sleep(delay, cancel.signal);
				if (cancel.signal.aborted) return false;
				if (!target || (await probe(target))) return !cancel.signal.aborted;
			}
		} finally {
			for (const stop of unsubscribe) stop();
			if (ctx.hasUI) ctx.ui.setWorkingMessage();
		}
	}
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, type);
	else if (type === "error") process.stderr.write(`2pi: ${message}\n`);
}
