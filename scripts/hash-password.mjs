#!/usr/bin/env node
// Print an LH_LOGIN_PASSWORD_HASH value for the login gate (lib/login-gate.ts).
// Usage: node scripts/hash-password.mjs   (reads the password from stdin)
import { randomBytes, scryptSync } from "node:crypto";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/\r?\n$/, "");
if (!password) {
	console.error("empty password");
	process.exit(1);
}
const salt = randomBytes(16);
console.log(`scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 32).toString("base64")}`);
