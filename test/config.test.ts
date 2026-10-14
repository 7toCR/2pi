/** Login and models configured the way pi is: import from codex and pi, 2pi's names in pi's help. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { isSelfUpdate, rebrandPiText } from "../src/core/branding.ts";
import { codexKeyCommand, importCodexConfig, providerIdFor } from "../src/core/codex-import.ts";
import { importPiConfig } from "../src/core/pi-import.ts";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function sandbox(): { root: string; agentDir: string; done(): void } {
	const root = mkdtempSync(join(tmpdir(), "2pi-config-"));
	const agentDir = join(root, "agent");
	return { root, agentDir, done: () => rmSync(root, { recursive: true, force: true }) };
}

describe("import-codex writes pi's own configuration", () => {
	test("the provider keeps its name, the key is a command in auth.json, the default model is set", () => {
		const { root, agentDir, done } = sandbox();
		try {
			const codexHome = join(root, "codex");
			mkdirSync(codexHome, { recursive: true });
			writeFileSync(
				join(codexHome, "config.toml"),
				[
					'model = "gpt-test"',
					'model_provider = "custom"',
					'model_reasoning_effort = "high"',
					"",
					"[model_providers.custom]",
					'name = "Super Hub"',
					'base_url = "https://hub.example.com/v1/"',
					'wire_api = "responses"',
				].join("\n"),
			);
			writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-test-123" }));
			const report = importCodexConfig({ agentDir, codexHome });
			assert.match(report.join("\n"), /super-hub\/gpt-test/);

			const provider = read(join(agentDir, "models.json")).providers["super-hub"];
			assert.equal(provider.name, "Super Hub");
			assert.equal(provider.baseUrl, "https://hub.example.com/v1");
			assert.equal(provider.api, "openai-responses");
			assert.equal(provider.apiKey, undefined, "credentials live in auth.json, like /login stores them");
			assert.equal(provider.models[0].id, "gpt-test");

			const credential = read(join(agentDir, "auth.json"))["super-hub"];
			assert.equal(credential.type, "api_key");
			assert.match(credential.key, /^!node -e "/);
			assert.doesNotMatch(credential.key, /sk-test-123/, "the key itself is never copied");
			// The command prints codex's key (run here without a shell; pi runs it through one).
			const script = /-e "(.*)"$/.exec(credential.key)?.[1] ?? "";
			const run = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, CODEX_HOME: codexHome }, encoding: "utf8" });
			assert.equal(run.stdout, "sk-test-123");

			assert.deepEqual(read(join(agentDir, "settings.json")), {
				defaultProvider: "super-hub",
				defaultModel: "gpt-test",
				defaultThinkingLevel: "high",
			});

			// A key the user stored with /login is kept on a second import.
			writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ "super-hub": { type: "api_key", key: "sk-own" } }));
			importCodexConfig({ agentDir, codexHome, model: "gpt-other" });
			assert.equal(read(join(agentDir, "auth.json"))["super-hub"].key, "sk-own");
			assert.deepEqual(
				read(join(agentDir, "models.json")).providers["super-hub"].models.map((model: { id: string }) => model.id),
				["gpt-test", "gpt-other"],
			);
		} finally {
			done();
		}
	});

	test("the key command reads the provider's env_key first and contains nothing a shell would expand", () => {
		const command = codexKeyCommand("HUB_KEY");
		assert.doesNotMatch(command.slice(1), /\$/);
		assert.equal(command.match(/"/g)?.length, 2);
		const script = /-e "(.*)"$/.exec(command)?.[1] ?? "";
		const run = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, HUB_KEY: "from-env", CODEX_HOME: tmpdir() }, encoding: "utf8" });
		assert.equal(run.stdout, "from-env");
		assert.equal(providerIdFor("My Relay (CN)"), "my-relay-cn");
		assert.equal(providerIdFor("  "), "codex");
	});
});

describe("import-pi carries a pi setup over unchanged", () => {
	test("providers and defaults are copied; only credentials that hold no secret are", () => {
		const { root, agentDir, done } = sandbox();
		try {
			const piDir = join(root, "pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(
				join(piDir, "models.json"),
				JSON.stringify({
					providers: { relay: { baseUrl: "https://relay.example.com", api: "openai-completions", apiKey: "$RELAY_KEY", models: [{ id: "m1" }] } },
					modelOverrides: { "anthropic/claude-x": { contextWindow: 1000 } },
				}),
			);
			writeFileSync(join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "relay", defaultModel: "m1", theme: "light" }));
			writeFileSync(
				join(piDir, "auth.json"),
				JSON.stringify({
					relay: { type: "api_key", key: "!pass show relay" },
					openai: { type: "api_key", key: "sk-literal" },
					anthropic: { type: "oauth", access: "a", refresh: "r", expires: 1 },
				}),
			);
			mkdirSync(agentDir, { recursive: true });
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ quietStartup: "header" }));

			const report = importPiConfig({ agentDir, piDir }).join("\n");
			assert.match(report, /provider relay（1 个模型）/);
			assert.match(report, /未复制 openai、anthropic 的登录信息/);
			assert.deepEqual(read(join(agentDir, "models.json")).providers.relay.models, [{ id: "m1" }]);
			assert.ok(read(join(agentDir, "models.json")).modelOverrides["anthropic/claude-x"]);
			assert.deepEqual(read(join(agentDir, "settings.json")), { quietStartup: "header", defaultProvider: "relay", defaultModel: "m1" });
			assert.deepEqual(Object.keys(read(join(agentDir, "auth.json"))), ["relay"]);
			assert.throws(() => importPiConfig({ agentDir, piDir: agentDir }), /同一个配置目录/);
		} finally {
			done();
		}
	});
});

describe("pi's help under 2pi's names", () => {
	test("commands, the config directory and pi's variables are renamed; aligned tables stay aligned", () => {
		const help = [
			"\x1b[1mpi\x1b[22m - AI coding assistant with read, bash, edit, write tools",
			"",
			"Usage:",
			"  pi [options] [--] [@files...]",
			"  # Interactive mode",
			"  pi",
			"  pi --export ~/.pi/agent/sessions/x.jsonl",
			"  PI_CODING_AGENT_DIR              - Config directory (default: ~/.pi/agent)",
			"  PI_PACKAGE_DIR                   - Override package directory",
			"  --offline    Disable startup network operations (same as PI_OFFLINE=1)",
			"See pi.dev for more.",
		].join("\n");
		const out = rebrandPiText(help).split("\n");
		assert.equal(out[0], "Usage:");
		assert.equal(out[1], "  2pi [options] [--] [@files...]");
		assert.equal(out[3], "  2pi");
		assert.equal(out[4], "  2pi --export ~/.2pi/agent/sessions/x.jsonl");
		assert.equal(out[5], "  TWOPI_CODING_AGENT_DIR           - Config directory (default: ~/.2pi/agent)");
		assert.equal(out[5]?.indexOf("-"), out[6]?.indexOf("-"));
		assert.equal(out[6], "  PI_PACKAGE_DIR                   - Override package directory", "pi-only variables keep their name");
		assert.match(out[7] ?? "", /same as TWOPI_OFFLINE=1/);
		assert.equal(out[8], "See pi.dev for more.");
	});

	test("2pi update only goes through for extensions and model catalogs", () => {
		for (const args of [["update"], ["update", "self"], ["update", "pi"], ["update", "--self"], ["update", "--all"]]) {
			assert.equal(isSelfUpdate(args), true, args.join(" "));
		}
		for (const args of [["update", "--models"], ["update", "--extensions"], ["update", "npm:foo"], ["update", "--help"], ["init", "paper"]]) {
			assert.equal(isSelfUpdate(args), false, args.join(" "));
		}
	});
});
