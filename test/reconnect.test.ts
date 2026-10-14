/** Reconnecting after a dropped connection (codex's "Reconnecting... waiting for network"). */
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { describe, test } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
	classifyNetworkError,
	MAX_RESUMES,
	offlineDelayMs,
	type ProbeTarget,
	probeTarget,
	tcpProbe,
} from "../src/core/reconnect.ts";
import { createTestAgent, textOf } from "./helpers.ts";

const failed = (errorMessage: string) => fauxAssistantMessage("", { stopReason: "error", errorMessage });
const say = (text: string) => fauxAssistantMessage(text);

function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
	// Windows environment names ignore case (HTTPS_PROXY is https_proxy): clear first, then set.
	const saved = Object.entries(values).map(([key]) => [key, process.env[key]] as const);
	const apply = (entries: ReadonlyArray<readonly [string, string | undefined]>) => {
		for (const [key, value] of entries) if (value === undefined) delete process.env[key];
		for (const [key, value] of entries) if (value !== undefined) process.env[key] = value;
	};
	apply(Object.entries(values));
	return run().finally(() => apply(saved));
}

const NO_PROXY_ENV = { HTTPS_PROXY: undefined, https_proxy: undefined, HTTP_PROXY: undefined, http_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined };

describe("what counts as a lost connection", () => {
	test("connection failures wait for the network; refusals and quota end the run", () => {
		for (const message of ["fetch failed", "getaddrinfo ENOTFOUND api.example.com", "read ECONNRESET", "Connection error.", "socket hang up", "terminated"]) {
			assert.equal(classifyNetworkError(message), "connection", message);
		}
		for (const message of ["401 Unauthorized", "insufficient_quota", "Invalid API key", "context length exceeded: maximum context"]) {
			assert.equal(classifyNetworkError(message), "permanent", message);
		}
		assert.equal(classifyNetworkError("503 Service Unavailable"), "other");
		assert.equal(classifyNetworkError(undefined), "other");
	});

	test("the wait follows codex: 5 s doubling to 60 s, with jitter", () => {
		const mid = () => 0.5;
		assert.deepEqual([1, 2, 3, 4, 5, 9].map((attempt) => offlineDelayMs(attempt, mid)), [5000, 10000, 20000, 40000, 60000, 60000]);
		assert.equal(offlineDelayMs(1, () => 0), 4500);
		assert.equal(offlineDelayMs(1, () => 1), 5500);
	});

	test("the probe goes to the proxy when there is one, else to the API host", async () => {
		await withEnv({ ...NO_PROXY_ENV }, async () => {
			assert.deepEqual(probeTarget("https://api.example.com/v1"), { host: "api.example.com", port: 443, via: "direct" });
			assert.deepEqual(probeTarget("http://localhost:11434/v1"), { host: "localhost", port: 11434, via: "direct" });
			assert.equal(probeTarget(undefined), undefined);
		});
		await withEnv({ ...NO_PROXY_ENV, HTTPS_PROXY: "http://127.0.0.1:7890" }, async () => {
			assert.deepEqual(probeTarget("https://api.example.com/v1"), { host: "127.0.0.1", port: 7890, via: "proxy" });
		});
	});

	test("a TCP probe succeeds against a listening port and fails against a closed one", async () => {
		const server = createServer((socket) => socket.end());
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as { port: number }).port;
		assert.equal(await tcpProbe({ host: "127.0.0.1", port, via: "direct" }), true);
		await new Promise<void>((resolve) => server.close(() => resolve()));
		assert.equal(await tcpProbe({ host: "127.0.0.1", port, via: "direct" }, 1000), false);
	});
});

describe("waiting for the network in a session", () => {
	test("after a connection failure the run waits, probes, and continues the turn where it stopped", async () => {
		const probes: ProbeTarget[] = [];
		const waits: number[] = [];
		await withEnv({ ...NO_PROXY_ENV, HTTPS_PROXY: "http://proxy.test:8080" }, async () => {
			const agent = await createTestAgent({
				extension: {
					reconnect: {
						sleep: async (ms) => {
							waits.push(ms);
						},
						// The network comes back on the second probe.
						probe: async (target) => (probes.push(target), probes.length >= 2),
						random: () => 0.5,
					},
				},
			});
			try {
				agent.setResponses([failed("fetch failed"), say("网络恢复后完成了")]);
				await agent.session.prompt("写一段摘要");
				const last = agent.session.messages.filter((message) => message.role === "assistant").at(-1);
				assert.equal(textOf(last), "网络恢复后完成了");
				assert.equal(agent.pendingResponses(), 0);
				assert.deepEqual(waits, [5000, 10000]);
				assert.deepEqual(probes, [
					{ host: "proxy.test", port: 8080, via: "proxy" },
					{ host: "proxy.test", port: 8080, via: "proxy" },
				]);
				// The failed attempt is kept in the session file but no longer in the model's context.
				const entries = agent.session.sessionManager.getBranch();
				assert.ok(entries.some((entry) => entry.type === "context_edit" && entry.replacement === null));
			} finally {
				agent.cleanup();
			}
		});
	});

	test("errors waiting cannot fix end the run without waiting", async () => {
		const waits: number[] = [];
		const agent = await createTestAgent({ extension: { reconnect: { sleep: async (ms) => void waits.push(ms), probe: async () => true } } });
		try {
			agent.setResponses([failed("401 Unauthorized: invalid api key"), say("不应出现")]);
			await agent.session.prompt("你好");
			assert.deepEqual(waits, []);
			assert.equal(agent.pendingResponses(), 1);
		} finally {
			agent.cleanup();
		}
	});

	test("a headless run stops waiting after TWOPI_RECONNECT_MAX_WAIT minutes", async () => {
		const waits: number[] = [];
		await withEnv({ TWOPI_RECONNECT_MAX_WAIT: "0" }, async () => {
			const agent = await createTestAgent({ extension: { reconnect: { sleep: async (ms) => void waits.push(ms), probe: async () => true } } });
			try {
				agent.setResponses([failed("fetch failed"), say("不应出现")]);
				await agent.session.prompt("你好");
				assert.deepEqual(waits, []);
				assert.equal(agent.pendingResponses(), 1);
			} finally {
				agent.cleanup();
			}
		});
	});

	test(`resumes stop after ${MAX_RESUMES} in a row that all fail again`, async () => {
		const agent = await createTestAgent({ extension: { reconnect: { sleep: async () => {}, probe: async () => true } } });
		try {
			agent.setResponses([...Array.from({ length: MAX_RESUMES + 1 }, () => failed("socket hang up")), say("不应出现")]);
			await agent.session.prompt("你好");
			assert.equal(agent.pendingResponses(), 1);
		} finally {
			agent.cleanup();
		}
	});
});
