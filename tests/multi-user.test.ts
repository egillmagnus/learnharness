/**
 * Multi-user mode (fork addition, 2026-10-24 — user-context.ts): two users
 * on one server see only their own chats, settings, keys, events, running
 * turns, sources and files; per-user reads outside a user context throw;
 * session cookies carry the user and can't be re-pointed at another.
 *
 * Module-load-bound seam: LH_USERS_FILE is set BEFORE the first import.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-multi-user-"));
const home = (id: string) => path.join(TMP, id);
fs.writeFileSync(
	path.join(TMP, "users.json"),
	JSON.stringify({
		users: [
			{ id: "ann", passwordHash: "", home: home("ann") },
			{ id: "bob", passwordHash: "", home: home("bob") },
		],
	}),
);
for (const id of ["ann", "bob"]) fs.mkdirSync(path.join(home(id), "sources", "courses"), { recursive: true });
process.env.LH_USERS_FILE = path.join(TMP, "users.json");
process.env.LH_SESSION_SECRET = "x".repeat(40);
process.env.OPENROUTER_API_KEY = "sk-or-v1-from-the-environment";

const { findUser, runAsUser } = await import("../user-context.ts");
const { PATHS } = await import("../config.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { keyValue, keyStatuses, saveKey } = await import("../src/server/keys.ts");
const { emit, subscribe } = await import("../src/core/events.ts");
const { registerTurn, runningTurn } = await import("../src/server/turn-runs.ts");
const { issueToken, tokenUser } = await import("../lib/login-gate.ts");
const { listCourses, createCourse } = await import("../lib/sources-store.ts");
const { resolveSourcePath } = await import("../src/agent/tools/fs-shared.ts");
const { openRouterApiKey } = await import("../src/agent/models.ts");

after(() => {
	fs.rmSync(TMP, { recursive: true, force: true });
});

const ann = findUser("ann")!;
const bob = findUser("bob")!;

describe("multi-user isolation", () => {
	it("refuses per-user reads outside a user context", () => {
		assert.throws(() => PATHS.data, /outside a user context/);
		// The chat store swallows read errors into "no chats" — still nothing leaks.
		assert.deepEqual(chatStore.listChats(), []);
	});

	it("keeps chats in each user's own data dir", () => {
		const chat = runAsUser(ann, () => chatStore.createChat("ann's chat"));
		assert.ok(fs.existsSync(path.join(home("ann"), "data", "chats", `${chat.id}.json`)));
		assert.deepEqual(runAsUser(bob, () => chatStore.listChats()), []);
		assert.equal(runAsUser(bob, () => chatStore.getChat(chat.id)), null);
		assert.equal(runAsUser(ann, () => chatStore.listChats()).length, 1);
	});

	it("keeps API keys per user and out of the shared environment", () => {
		assert.equal(process.env.OPENROUTER_API_KEY, undefined, "boot must clear provider keys from env");
		runAsUser(ann, () => assert.ok(saveKey("OPENROUTER_API_KEY", "sk-or-v1-" + "a".repeat(64)).ok));
		assert.equal(process.env.OPENROUTER_API_KEY, undefined);
		assert.equal(runAsUser(ann, () => openRouterApiKey()), "sk-or-v1-" + "a".repeat(64));
		assert.equal(runAsUser(bob, () => keyValue("OPENROUTER_API_KEY")), undefined);
		assert.equal(runAsUser(bob, () => openRouterApiKey()), undefined);
		const bobRow = runAsUser(bob, () => keyStatuses().find((s) => s.id === "OPENROUTER_API_KEY"));
		assert.equal(bobRow?.present ?? false, false);
	});

	it("delivers events only to the emitting user's listeners", () => {
		const seen: string[] = [];
		const offAnn = runAsUser(ann, () => subscribe((e) => seen.push(`ann:${e.type}`)));
		const offBob = runAsUser(bob, () => subscribe((e) => seen.push(`bob:${e.type}`)));
		runAsUser(ann, () => emit("chats-changed", {}));
		runAsUser(bob, () => emit("jobs-changed", { chatId: "x" } as never));
		offAnn();
		offBob();
		assert.deepEqual(seen, ["ann:chats-changed", "bob:jobs-changed"]);
	});

	it("scopes in-memory registries by user", () => {
		const handle = { abort() {} } as never;
		runAsUser(ann, () => registerTurn("chat_same_id", handle));
		assert.equal(runAsUser(bob, () => runningTurn("chat_same_id")), undefined);
		assert.equal(runAsUser(ann, () => runningTurn("chat_same_id")), handle);
	});

	it("gives each user their own sources and file fence", async () => {
		await runAsUser(ann, () => createCourse("Algebra"));
		assert.deepEqual((await runAsUser(bob, () => listCourses())).map((c) => c.name), []);
		assert.equal(runAsUser(ann, () => resolveSourcePath("notes")), path.join(home("ann"), "notes"));
		assert.throws(() => runAsUser(bob, () => resolveSourcePath(path.join(home("ann"), "notes"))), /Access denied/);
	});

	it("signs the user into the session cookie", () => {
		const { value } = issueToken(true, "ann");
		assert.equal(tokenUser(value), "ann");
		assert.equal(tokenUser(value.replace(/^ann/, "bob")), null, "re-pointing the cookie breaks the signature");
		assert.equal(tokenUser(issueToken(true, "carol").value), null, "unknown users are signed out");
		assert.equal(tokenUser(issueToken(true).value), null, "single-user cookies don't work multi-user");
	});
});

describe("multi-user module loading", () => {
	it("imports every server module without a user (no load-time per-user reads)", async () => {
		await import("../src/store/graph.ts");
		await import("../src/server/index.ts");
	});
});
