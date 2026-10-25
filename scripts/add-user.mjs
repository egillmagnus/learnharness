#!/usr/bin/env node
// Add a learner to LH_USERS_FILE (multi-user mode, user-context.ts), or
// give an existing one a new password. Prints a generated password once.
//
// Usage:
//   LH_USERS_FILE=… node scripts/add-user.mjs <id> <home dir>   add a user
//   LH_USERS_FILE=… node scripts/add-user.mjs <id> --reset      new password
//
// A new user's data, keys and course folders all live under <home dir>
// (data/, auth.json, sources/courses/). The running server re-reads the
// users file on change; no restart needed.
import { randomBytes, randomInt, scryptSync } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const file = process.env.LH_USERS_FILE;
const [id, arg] = process.argv.slice(2);
if (!file || !id || !arg) {
	console.error("usage: LH_USERS_FILE=… node scripts/add-user.mjs <id> <home dir> | --reset");
	process.exit(1);
}
if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) {
	console.error("ids are lowercase letters, digits, - and _ (max 32)");
	process.exit(1);
}

const registry = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { users: [] };
registry.users ??= [];
const existing = registry.users.find((u) => u.id === id);

// xxxx-xxxx-xxxx-xxxx from an unambiguous alphabet (no 0/o/1/l/i).
const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
const password = Array.from({ length: 4 }, () =>
	Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(""),
).join("-");
const salt = randomBytes(16);
const passwordHash = `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 32).toString("base64")}`;

if (arg === "--reset") {
	if (!existing) {
		console.error(`no user "${id}"`);
		process.exit(1);
	}
	existing.passwordHash = passwordHash;
} else {
	if (existing) {
		console.error(`user "${id}" exists (use --reset for a new password)`);
		process.exit(1);
	}
	const home = path.resolve(arg);
	for (const dir of [home, path.join(home, "data"), path.join(home, "sources", "courses")]) {
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	registry.users.push({ id, passwordHash, home });
}

const tmp = `${file}.tmp-${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(registry, null, "\t") + "\n", { mode: 0o600 });
fs.renameSync(tmp, file);
console.log(`${arg === "--reset" ? "New password for" : "Added"} ${id}: ${password}`);
