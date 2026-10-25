/**
 * One-time password links (fork addition, 2026-10-25 — lib/password-reset.ts,
 * scripts/password-link.mjs): a link sets the password once, then is dead;
 * expired and unknown tokens do nothing; the users file keeps only a hash.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-password-reset-"));
const USERS = path.join(TMP, "users.json");
fs.writeFileSync(USERS, JSON.stringify({ users: [{ id: "ann", passwordHash: "old", home: path.join(TMP, "ann") }] }));
process.env.LH_USERS_FILE = USERS;

const { resetTokenUser, setPasswordWithToken } = await import("../lib/password-reset.ts");
const { authenticate } = await import("../lib/login-gate.ts");

after(() => {
	fs.rmSync(TMP, { recursive: true, force: true });
});

function link(minutes = "30"): string {
	const out = execFileSync(process.execPath, ["scripts/password-link.mjs", "ann", minutes], {
		env: { ...process.env, LH_USERS_FILE: USERS, LH_PUBLIC_URL: "https://learn.test" },
		encoding: "utf8",
	});
	return new URL(out.split("\n")[0]!).searchParams.get("token")!;
}

describe("one-time password links", () => {
	it("stores only a hash of the token", () => {
		const token = link();
		const raw = fs.readFileSync(USERS, "utf8");
		assert.ok(!raw.includes(token));
		assert.match(raw, /"resetTokenHash": "[0-9a-f]{64}"/);
	});

	it("sets the password once, then the link is dead", () => {
		const token = link();
		assert.equal(resetTokenUser(token), "ann");
		assert.equal(setPasswordWithToken(token, "correct horse battery"), "ann");
		assert.equal(authenticate("ann", "correct horse battery"), "ann");
		assert.equal(resetTokenUser(token), null);
		assert.equal(setPasswordWithToken(token, "something else entirely"), null);
		assert.equal(authenticate("ann", "correct horse battery"), "ann");
		assert.ok(!fs.readFileSync(USERS, "utf8").includes("resetTokenHash"));
	});

	it("refuses expired and unknown tokens", () => {
		const token = link();
		assert.equal(resetTokenUser(token, Date.now() + 31 * 60 * 1000), null);
		assert.equal(resetTokenUser("not-a-token"), null);
		assert.equal(resetTokenUser(""), null);
	});

	it("a newer link replaces an older one", () => {
		const first = link();
		const second = link();
		assert.equal(resetTokenUser(first), null);
		assert.equal(resetTokenUser(second), "ann");
	});
});
