/**
 * /setup and /doctor: saved service keys (the environment still wins), the project card's
 * online-search switch, and the checks against a scripted network.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { coreChecks, formatDoctor } from "../src/core/doctor.ts";
import { type FetchLike, setFetch } from "../src/core/online.ts";
import { initProject, readProjectCard } from "../src/core/project.ts";
import { describeKey, maskKey, saveServiceKeys, serviceKey, serviceKeySource, servicesPath } from "../src/core/services.ts";
import { runSetupArgs, setOnlineSearch } from "../src/core/setup.ts";
import { researchChecks } from "../src/packs/research/doctor.ts";
import { createTestAgent } from "./helpers.ts";

/** A temporary 2pi config directory (PI_CODING_AGENT_DIR) and project directory for one test. */
async function withDirs(run: (dirs: { agentDir: string; cwd: string }) => Promise<void> | void): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "2pi-setup-"));
	const saved = { dir: process.env.PI_CODING_AGENT_DIR, key: process.env.TWOPI_OPENALEX_KEY, offline: process.env.TWOPI_OFFLINE };
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	delete process.env.TWOPI_OPENALEX_KEY;
	delete process.env.TWOPI_OFFLINE;
	try {
		mkdirSync(join(root, "project"));
		await run({ agentDir: join(root, "agent"), cwd: join(root, "project") });
	} finally {
		for (const [name, value] of [
			["PI_CODING_AGENT_DIR", saved.dir],
			["TWOPI_OPENALEX_KEY", saved.key],
			["TWOPI_OFFLINE", saved.offline],
		] as const) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		rmSync(root, { recursive: true, force: true });
	}
}

const reply = (status: number, body = "", json: unknown = {}) => ({
	status,
	ok: status >= 200 && status < 300,
	json: async () => json,
	text: async () => body,
});

/** Every service healthy, except what `overrides` answers for a host. */
function serviceFetch(overrides: Record<string, () => ReturnType<typeof reply>> = {}, seen: string[] = []): FetchLike {
	return async (url) => {
		seen.push(url);
		const host = new URL(url).host;
		if (overrides[host]) return overrides[host]();
		if (host === "export.arxiv.org") return reply(200, "<feed><entry><title>Attention Is All You Need</title></entry></feed>");
		return reply(200, "{}");
	};
}

describe("service keys", () => {
	test("saved keys are read back, masked in status, cleared, and an environment variable wins", () =>
		withDirs(({ agentDir }) => {
			assert.equal(serviceKey("OPENALEX_KEY"), undefined);
			assert.equal(describeKey("OPENALEX_KEY"), "未配置");
			saveServiceKeys({ OPENALEX_KEY: " abcdef123456 ", EPO_OPS_KEY: "k1" });
			assert.equal(servicesPath(), join(agentDir, "services.json"));
			assert.equal(serviceKey("OPENALEX_KEY"), "abcdef123456");
			assert.equal(serviceKeySource("OPENALEX_KEY"), "saved");
			assert.equal(describeKey("OPENALEX_KEY"), "已保存（abcd…3456）");
			assert.equal(maskKey("short"), "•••••");
			// Saving one key keeps the others; an empty value removes one.
			saveServiceKeys({ EPO_OPS_SECRET: "s1" });
			assert.deepEqual(JSON.parse(readFileSync(servicesPath(), "utf8")), { OPENALEX_KEY: "abcdef123456", EPO_OPS_KEY: "k1", EPO_OPS_SECRET: "s1" });
			process.env.TWOPI_OPENALEX_KEY = "from-environment";
			assert.equal(serviceKey("OPENALEX_KEY"), "from-environment");
			assert.equal(serviceKeySource("OPENALEX_KEY"), "env");
			assert.match(describeKey("OPENALEX_KEY"), /^环境变量 TWOPI_OPENALEX_KEY/);
			delete process.env.TWOPI_OPENALEX_KEY;
			saveServiceKeys({ OPENALEX_KEY: undefined });
			assert.equal(serviceKey("OPENALEX_KEY"), undefined);
			assert.equal(serviceKey("EPO_OPS_KEY"), "k1");
		}));
});

describe("/setup", () => {
	test("arguments save and clear keys and switch the project's online search", () =>
		withDirs(({ cwd }) => {
			assert.equal(runSetupArgs("frobnicate", cwd), undefined);
			assert.match(runSetupArgs("", cwd)!.text, /本项目联网检索：当前目录没有 2PI\.md/);
			assert.match(runSetupArgs("online on", cwd)!.text, /先用 \/init/);
			assert.match(runSetupArgs("openalex", cwd)!.text, /用法/);

			assert.match(runSetupArgs("openalex abcdef123456", cwd)!.text, /已保存 OpenAlex key（abcd…3456）/);
			assert.equal(serviceKey("OPENALEX_KEY"), "abcdef123456");
			runSetupArgs("epo key-1234567 secret-7654321", cwd);
			assert.equal(serviceKey("EPO_OPS_SECRET"), "secret-7654321");
			runSetupArgs("clear epo", cwd);
			assert.equal(serviceKey("EPO_OPS_KEY"), undefined);
			assert.equal(serviceKey("OPENALEX_KEY"), "abcdef123456");

			initProject(cwd, "paper");
			assert.equal(readProjectCard(cwd).onlineSearch, false);
			assert.match(runSetupArgs("online on", cwd)!.text, /联网检索：允许/);
			assert.equal(readProjectCard(cwd).onlineSearch, true);
			const status = runSetupArgs("status", cwd)!.text;
			assert.match(status, /OpenAlex API key：已保存（abcd…3456）/);
			assert.match(status, /EPO OPS 专利检索账号：未配置/);
			assert.match(status, /本项目联网检索：允许/);
			runSetupArgs("online off", cwd);
			assert.equal(readProjectCard(cwd).onlineSearch, false);
		}));

	test("the online-search field is rewritten in place, or added with its section", () => {
		const card = "# 卡\r\n\r\n- 联网检索：不允许（说明）\r\n\r\n后文\r\n";
		assert.equal(setOnlineSearch(card, true), "# 卡\r\n\r\n- 联网检索：允许\r\n\r\n后文\r\n");
		assert.equal(setOnlineSearch("- Online search: no\n", true), "- Online search: 允许\n");
		const added = setOnlineSearch("# 2pi 项目卡\n\n- 类型：paper\n", true);
		assert.equal(added, "# 2pi 项目卡\n\n- 类型：paper\n\n## 调研\n\n- 联网检索：允许\n");
	});
});

describe("commands in a session", () => {
	test("/setup and /doctor run as commands, print without a UI, and never reach the model", async () => {
		const offline = process.env.TWOPI_OFFLINE;
		process.env.TWOPI_OFFLINE = "1";
		const agent = await createTestAgent({ files: { "2PI.md": "# 2pi 项目卡\n\n- 类型：paper\n- 联网检索：不允许\n" } });
		const printed: string[] = [];
		const log = console.log;
		console.log = (...parts: unknown[]) => printed.push(parts.join(" "));
		try {
			await agent.session.prompt("/setup openalex abcdef123456");
			await agent.session.prompt("/setup online on");
			await agent.session.prompt("/doctor");
		} finally {
			console.log = log;
			if (offline === undefined) delete process.env.TWOPI_OFFLINE;
			else process.env.TWOPI_OFFLINE = offline;
		}
		try {
			const out = printed.join("\n");
			assert.match(out, /已保存 OpenAlex key（abcd…3456）/);
			assert.match(out, /2PI\.md 已改为"联网检索：允许"/);
			assert.match(out, /2pi 检测[\s\S]*本项目\n {2}✓ 联网检索[\s\S]*– 检索服务：设置了 TWOPI_OFFLINE/);
			assert.equal(readProjectCard(agent.cwd).onlineSearch, true);
			assert.equal(JSON.parse(readFileSync(join(agent.root, "agent-home", "services.json"), "utf8")).OPENALEX_KEY, "abcdef123456");
			assert.equal(agent.session.messages.filter((m) => m.role === "assistant").length, 0);
		} finally {
			agent.cleanup();
		}
	});
});

describe("/doctor", () => {
	test("healthy services pass; a refused OpenAlex key, a spent quota and an unreachable host are told apart", () =>
		withDirs(async () => {
			const seen: string[] = [];
			const previous = setFetch(serviceFetch({}, seen));
			try {
				const healthy = await researchChecks();
				assert.deepEqual(
					healthy.map((c) => [c.name, c.status]),
					[
						["OpenAlex", "ok"],
						["arXiv", "ok"],
						["Crossref", "ok"],
						["DataCite", "ok"],
						["EPO OPS", "skip"],
					],
				);
				assert.match(healthy[0]!.detail, /未配置 key/);
				// Fixed test requests only: a generic word and a long-published identifier.
				assert.ok(seen.every((url) => /transformer|1706\.03762/.test(url)), seen.join("\n"));

				saveServiceKeys({ OPENALEX_KEY: "bad-key-123456" });
				setFetch(
					serviceFetch({
						"api.openalex.org": () => reply(401),
						"api.crossref.org": () => {
							throw new Error("getaddrinfo ENOTFOUND api.crossref.org");
						},
						"api.datacite.org": () => reply(429),
					}),
				);
				const broken = await researchChecks();
				const by = (name: string) => broken.find((c) => c.name === name)!;
				assert.equal(by("OpenAlex").status, "fail");
				assert.equal(by("OpenAlex").credentialsRejected, true);
				assert.match(by("OpenAlex").fix ?? "", /\/setup/);
				assert.equal(by("Crossref").status, "fail");
				assert.match(by("Crossref").detail, /连不上 api\.crossref\.org/);
				assert.equal(by("DataCite").status, "fail");

				setFetch(serviceFetch({ "api.openalex.org": () => reply(429) }));
				saveServiceKeys({ OPENALEX_KEY: undefined });
				assert.equal((await researchChecks())[0]!.status, "warn");

				process.env.TWOPI_OFFLINE = "1";
				assert.deepEqual(
					(await researchChecks()).map((c) => c.status),
					["skip"],
				);
			} finally {
				setFetch(previous);
			}
		}));

	test("core checks report a missing model and a directory without a project card; the report counts each status", () =>
		withDirs(({ cwd }) => {
			const checks = coreChecks({ cwd, model: undefined, modelRegistry: {} as never });
			const model = checks.find((c) => c.name === "模型")!;
			assert.equal(model.status, "fail");
			assert.match(model.fix ?? "", /\/login/);
			assert.equal(checks.find((c) => c.name === "项目卡")?.status, "skip");
			const text = formatDoctor([...checks, { group: "文献检索", name: "arXiv", status: "ok", detail: "正常" }]);
			assert.match(text, /✗ 模型：还没有选择模型\n {6}→ 用 \/login/);
			assert.match(text, /文献检索\n {2}✓ arXiv：正常/);
			assert.match(text, /共 \d+ 项：\d+ 正常、\d+ 需要留意、1 失败、1 未检测。/);
		}));
});
