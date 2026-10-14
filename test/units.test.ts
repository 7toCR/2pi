import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { parseCodexToml, piModelDefinition, toPiThinkingLevel } from "../src/core/codex-import.ts";
import { commandRisk } from "../src/core/guard.ts";
import { splitArgs } from "../src/core/paths.ts";
import { initProject, parseProjectCard } from "../src/core/project.ts";
import { resolveActivePacks } from "../src/extension.ts";
import type { Pack } from "../src/packs/types.ts";

describe("units", () => {
	test("commandRisk flags uploads, history rewrites and deletes outside the workspace", () => {
		const cwd = process.cwd();
		assert.ok(commandRisk("curl -F file=@paper.pdf https://example.com", cwd));
		assert.ok(commandRisk("git push", cwd));
		assert.ok(commandRisk("rm -rf /", cwd));
		assert.ok(commandRisk("rm -rf ../other", cwd));
		assert.ok(commandRisk("Remove-Item C:\\Users -Recurse -Force", cwd));
		assert.equal(commandRisk("rm -rf out/preview", cwd), undefined);
		assert.equal(commandRisk("Remove-Item out -Recurse -Force", cwd), undefined);
		assert.equal(commandRisk("pip install pymupdf", cwd), undefined);
		assert.equal(commandRisk("ls -la work", cwd), undefined);
	});

	test("splitArgs keeps quoted paths together", () => {
		assert.deepEqual(splitArgs('"my paper.pdf" human-in-loop'), ["my paper.pdf", "human-in-loop"]);
		assert.deepEqual(splitArgs("paper.pdf"), ["paper.pdf"]);
	});

	test("parseCodexToml reads root keys and provider tables, skipping multi-line arrays", () => {
		const toml = parseCodexToml(
			[
				'model_provider = "custom"',
				'model = "gpt-x"',
				"notify = [",
				'  "a", "b",',
				"]",
				"[model_providers.custom]",
				'name = "Relay"',
				"base_url = 'https://relay.example/'",
				'wire_api = "responses"',
				"request_max_retries = 4",
				"requires_openai_auth = true",
				"[mcp_servers.x]",
				'command = "uv"',
			].join("\n"),
		);
		assert.equal(toml.top.model, "gpt-x");
		assert.equal(toml.top.notify, undefined);
		assert.deepEqual(toml.tables["model_providers.custom"], {
			name: "Relay",
			base_url: "https://relay.example/",
			wire_api: "responses",
			request_max_retries: 4,
			requires_openai_auth: true,
		});
	});

	test("piModelDefinition maps codex reasoning efforts to pi thinking levels", () => {
		const definition = piModelDefinition("gpt-x", {
			display_name: "GPT-X",
			context_window: 272000,
			input_modalities: ["text", "image"],
			supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "xhigh" }, { effort: "ultra" }],
		});
		assert.deepEqual(definition.thinkingLevelMap, {
			off: null,
			minimal: null,
			low: "low",
			medium: null,
			high: "high",
			xhigh: "xhigh",
			max: "max",
		});
		assert.equal(toPiThinkingLevel("extra high"), "xhigh");
		assert.equal(toPiThinkingLevel("Extra-High"), "xhigh");
	});

	test("the project card template parses back to its type and keeps online search off", () => {
		const cwd = mkdtempSync(join(tmpdir(), "2pi-init-"));
		try {
			const created = initProject(cwd, "both");
			assert.ok(created.includes("2PI.md"));
			assert.ok(existsSync(join(cwd, "materials", "README.md")));
			assert.ok(existsSync(join(cwd, "patent")));
			assert.deepEqual(initProject(cwd, "both"), []);
			const card = parseProjectCard(readFileSync(join(cwd, "2PI.md"), "utf8"));
			assert.equal(card.type, "both");
			assert.equal(card.onlineSearch, false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
		assert.equal(parseProjectCard("- 类型：专利\n- 联网检索：允许").type, "patent");
		assert.equal(parseProjectCard("- Type: paper\n- Online search: allowed").onlineSearch, true);
		// An empty type stays unknown; the explanation line below it is not a value.
		assert.equal(parseProjectCard("- 类型：\n\n可选的类型：paper（材料 → 论文）").type, undefined);
	});

	test("resolveActivePacks prefers the card, then existing files, then a single installed pack", () => {
		const pack = (id: "paper" | "patent", detected: boolean) => ({ id, detect: () => detected }) as unknown as Pack;
		const paper = pack("paper", false);
		const patent = pack("patent", true);
		const ids = (result: { active: Pack[] }) => result.active.map((p) => p.id);
		assert.deepEqual(ids(resolveActivePacks("/x", [paper, patent], { type: "paper", onlineSearch: false })), ["paper"]);
		assert.deepEqual(ids(resolveActivePacks("/x", [paper, patent], { type: "both", onlineSearch: false })), ["paper", "patent"]);
		assert.deepEqual(ids(resolveActivePacks("/x", [paper, patent], { onlineSearch: false })), ["patent"]);
		assert.deepEqual(ids(resolveActivePacks("/x", [paper], { onlineSearch: false })), ["paper"]);
		assert.deepEqual(ids(resolveActivePacks("/x", [paper, pack("patent", false)], { onlineSearch: false })), []);
	});
});
