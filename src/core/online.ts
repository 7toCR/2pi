import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureStateDir, readProjectCard, STATE_DIR } from "./project.ts";
import type { CoreState } from "./state.ts";

/**
 * Everything that leaves the machine goes through here: the project's permission to search
 * online, polite HTTP with retries, and a log of every query sent to a third-party service.
 */

export type FetchLike = (
	url: string,
	init?: { method?: string; body?: string; signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
	status: number;
	ok: boolean;
	headers?: { get(name: string): string | null };
	json(): Promise<unknown>;
	text?(): Promise<string>;
	arrayBuffer?(): Promise<ArrayBuffer>;
}>;

/** Identifies the tool, as the scholarly APIs ask; carries no personal contact data. */
export const USER_AGENT = "2pi-agent/0.3 (https://github.com/7toCR/paper2patent)";

// The global fetch goes through pi's proxy settings; tests swap in a scripted one.
let fetchImpl: FetchLike = (url, init) => fetch(url, init);

/** Replace the fetch used by online tools (tests). Returns the previous one. */
export function setFetch(fn: FetchLike): FetchLike {
	const previous = fetchImpl;
	fetchImpl = fn;
	return previous;
}

export function currentFetch(): FetchLike {
	return fetchImpl;
}

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(signal.reason);
		});
	});

/** Delay before retry n (0-based): Retry-After when given (capped), else 1 s, 2 s, 4 s. */
export function retryDelay(attempt: number, retryAfter: string | null | undefined): number {
	const seconds = Number(retryAfter);
	if (retryAfter && Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 10) * 1000;
	return 1000 * 2 ** attempt;
}

export interface RequestOptions {
	method?: string;
	body?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	signal?: AbortSignal;
	retries?: number;
	fetchFn?: FetchLike;
}

/** A request with a per-attempt timeout; rate limiting (429) and 503 are retried up to three times. */
export async function request(url: string, options: RequestOptions = {}) {
	const fetchFn = options.fetchFn ?? fetchImpl;
	const retries = options.retries ?? 3;
	for (let attempt = 0; ; attempt++) {
		const timeout = AbortSignal.timeout(options.timeoutMs ?? 20_000);
		const res = await fetchFn(url, {
			method: options.method,
			body: options.body,
			headers: { "User-Agent": USER_AGENT, ...options.headers },
			signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
		});
		if ((res.status !== 429 && res.status !== 503) || attempt >= retries) return res;
		await sleep(retryDelay(attempt, res.headers?.get("retry-after")), options.signal);
	}
}

export async function getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
	const res = await request(url, { ...options, headers: { Accept: "application/json", ...options.headers } });
	if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
	return (await res.json()) as T;
}

export async function getText(url: string, options: RequestOptions = {}): Promise<string> {
	const res = await request(url, options);
	if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
	if (!res.text) throw new Error("this fetch cannot read text responses");
	return res.text();
}

/** The services online research tools may contact, for permission prompts. */
export const SEARCH_SERVICES = "OpenAlex、arXiv、Crossref 以及已配置的专利检索服务（EPO OPS）";

/**
 * Searching sends query words to third parties, and for an unfiled invention the words themselves
 * can disclose it. Allowed when the project card says 联网检索：允许; otherwise the terminal UI
 * asks once per session; elsewhere the tool refuses and the model has to tell the user.
 */
export async function ensureOnline(ctx: ExtensionContext, core: CoreState): Promise<void> {
	if (core.onlineGranted || readProjectCard(ctx.cwd).onlineSearch) return;
	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm(
			"允许联网检索？",
			`本会话中 2pi 会把检索词发送给 ${SEARCH_SERVICES}；论文、稿件和材料不会上传，每次检索都记在 /research 中。尚未申请的发明，检索词本身也可能泄露发明点。在 /setup 中开启本项目联网检索（即项目卡 2PI.md 写"联网检索：允许"）后不再询问。`,
		);
		if (ok) {
			core.onlineGranted = true;
			return;
		}
		throw new Error("用户没有允许联网检索。不要再次尝试检索；改为写出检索式，让用户自己检索后把结果导出给你。");
	}
	throw new Error(
		'项目卡 2PI.md 没有允许联网检索（需要写"联网检索：允许"），本次没有发出任何请求。不要修改项目卡；告诉用户可以用 /setup online on 授权，或者改为写出检索式，让用户自己检索后把结果导出给你。',
	);
}

export interface SearchRecord {
	time: string;
	tool: string;
	service: string;
	query: string;
	results?: number;
	error?: string;
}

export function searchLogPath(cwd: string): string {
	return join(cwd, STATE_DIR, "research", "searches.jsonl");
}

/** Append one query to the project's search log (what left the machine, when, to whom). */
export function logSearch(cwd: string, record: Omit<SearchRecord, "time">): void {
	ensureStateDir(cwd);
	const path = searchLogPath(cwd);
	mkdirSync(join(path, ".."), { recursive: true });
	appendFileSync(path, `${JSON.stringify({ time: new Date().toISOString(), ...record })}\n`, "utf8");
}

export function readSearches(cwd: string): SearchRecord[] {
	const path = searchLogPath(cwd);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim())
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as SearchRecord];
			} catch {
				return [];
			}
		});
}
