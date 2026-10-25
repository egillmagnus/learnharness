#!/usr/bin/env node
// Print a one-time "set your password" link for a user in LH_USERS_FILE
// (multi-user mode; consumed by /set-password, lib/password-reset.ts).
// The link works once and expires after <minutes> (default 30). Only a
// SHA-256 of the token is stored; a newer link replaces an older one.
//
// Usage: LH_USERS_FILE=… LH_PUBLIC_URL=https://learn.example node scripts/password-link.mjs <id> [minutes]
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";

const file = process.env.LH_USERS_FILE;
const [id, minutesArg] = process.argv.slice(2);
const minutes = Number(minutesArg ?? 30);
if (!file || !id || !(minutes > 0)) {
	console.error("usage: LH_USERS_FILE=… [LH_PUBLIC_URL=…] node scripts/password-link.mjs <id> [minutes]");
	process.exit(1);
}

const registry = JSON.parse(fs.readFileSync(file, "utf8"));
const user = (registry.users ?? []).find((u) => u.id === id);
if (!user) {
	console.error(`no user "${id}"`);
	process.exit(1);
}

const token = randomBytes(24).toString("base64url");
user.resetTokenHash = createHash("sha256").update(token).digest("hex");
user.resetExpires = Date.now() + minutes * 60 * 1000;

const tmp = `${file}.tmp-${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(registry, null, "\t") + "\n", { mode: 0o600 });
fs.renameSync(tmp, file);

const base = (process.env.LH_PUBLIC_URL ?? "").replace(/\/$/, "");
console.log(`${base}/set-password?token=${token}`);
console.log(`(valid ${minutes} min, once)`);
