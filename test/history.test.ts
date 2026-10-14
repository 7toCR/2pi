import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Checkpoints } from "../src/core/checkpoints.ts";
import { History } from "../src/core/history.ts";
import { createTestAgent } from "./helpers.ts";

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });

describe("checkpoints and change sets", () => {
	test("each agent turn becomes a change set that /undo can revert", async () => {
		const agent = await createTestAgent({ files: { "notes/memo.md": "第一版\n" } });
		try {
			agent.setResponses([
				call("edit", { path: "notes/memo.md", edits: [{ oldText: "第一版", newText: "第二版" }] }),
				call("write", { path: "notes/new.md", content: "新文件\n" }),
				fauxAssistantMessage("改好了"),
			]);
			await agent.session.prompt("改一下说明");
			const history = new History(agent.cwd);
			const changes = history.changes.list();
			assert.equal(changes.length, 1);
			const change = changes[0];
			assert.ok(change);
			assert.equal(change.prompt, "改一下说明");
			assert.deepEqual(
				change.files.map((file) => [file.path, file.status]),
				[
					["notes/memo.md", "modified"],
					["notes/new.md", "added"],
				],
			);
			// The state directory ignores itself, so the user's own git never sees it.
			assert.equal(readFileSync(join(agent.cwd, ".2pi", ".gitignore"), "utf8").trim(), "*");

			assert.match(history.undo(false), /已撤回 c0001/);
			assert.equal(readFileSync(join(agent.cwd, "notes", "memo.md"), "utf8"), "第一版\n");
			assert.ok(!existsSync(join(agent.cwd, "notes", "new.md")));
			assert.ok(history.changes.get("c0001")?.undoneBy);
			assert.match(history.undo(false), /没有可撤回的修改/);
		} finally {
			agent.cleanup();
		}
	});

	test("undo leaves files edited after the turn alone unless forced", () => {
		const cwd = mkdtempSync(join(tmpdir(), "2pi-history-"));
		try {
			writeFileSync(join(cwd, "a.md"), "v1\n");
			const history = new History(cwd);
			history.beginTurn("改 a");
			writeFileSync(join(cwd, "a.md"), "v2\n");
			assert.ok(history.endTurn());
			// The user edits the file again after the agent's turn.
			writeFileSync(join(cwd, "a.md"), "v3 by user\n");
			assert.match(history.undo(false), /未撤回/);
			assert.equal(readFileSync(join(cwd, "a.md"), "utf8"), "v3 by user\n");
			assert.match(history.undo(true), /已撤回/);
			assert.equal(readFileSync(join(cwd, "a.md"), "utf8"), "v1\n");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("a turn without file changes records nothing, and manual edits are their own checkpoint", () => {
		const cwd = mkdtempSync(join(tmpdir(), "2pi-history-"));
		try {
			writeFileSync(join(cwd, "a.md"), "v1\n");
			const history = new History(cwd);
			history.beginTurn("只是提问");
			assert.equal(history.endTurn(), undefined);
			writeFileSync(join(cwd, "a.md"), "user edit\n");
			history.beginTurn("再问一次");
			assert.equal(history.endTurn(), undefined);
			const log = history.checkpoints.log();
			assert.equal(log[0]?.message, "手动修改");
			assert.equal(history.changes.list().length, 0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("checkpoints stay off in directories that are not drafting projects", () => {
		const cwd = mkdtempSync(join(tmpdir(), "2pi-history-"));
		try {
			for (let i = 0; i < 5005; i++) writeFileSync(join(cwd, `f${i}.txt`), "");
			const checkpoints = new Checkpoints(cwd);
			assert.equal(checkpoints.snapshot("x"), undefined);
			assert.match(checkpoints.disabledReason ?? "", /超过 5000/);
			assert.ok(!existsSync(join(cwd, ".2pi")));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
