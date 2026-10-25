/**
 * One-time "set your password" links (fork addition, 2026-10-25) for
 * multi-user mode (user-context.ts). scripts/password-link.mjs stores a
 * SHA-256 of a random token and an expiry on the user in LH_USERS_FILE and
 * prints /set-password?token=…; that page consumes the token once. Only
 * the hash is stored, so the users file never holds a usable link.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";

export const MIN_PASSWORD_LENGTH = 10;

interface RawUser {
	id: string;
	passwordHash?: string;
	resetTokenHash?: string;
	resetExpires?: number;
	[key: string]: unknown;
}

function usersFile(): string | undefined {
	return process.env.LH_USERS_FILE || undefined;
}

function readUsers(file: string): { users: RawUser[] } {
	const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { users?: RawUser[] };
	return { ...parsed, users: parsed.users ?? [] };
}

function digest(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 32).toString("base64")}`;
}

/** The user an unexpired, unused token belongs to, or null. */
export function resetTokenUser(token: string, now = Date.now()): string | null {
	const file = usersFile();
	if (!file || !token) return null;
	const want = Buffer.from(digest(token));
	const user = readUsers(file).users.find((u) => {
		const stored = typeof u.resetTokenHash === "string" ? Buffer.from(u.resetTokenHash) : null;
		return stored !== null && stored.length === want.length && timingSafeEqual(stored, want);
	});
	return user && Number(user.resetExpires) > now ? user.id : null;
}

/** Set the token's user's password and burn the token. Returns the user
 *  id, or null when the token is invalid, expired or already used. */
export function setPasswordWithToken(token: string, password: string, now = Date.now()): string | null {
	const file = usersFile();
	const id = resetTokenUser(token, now);
	if (!file || !id) return null;
	const registry = readUsers(file);
	const user = registry.users.find((u) => u.id === id)!;
	user.passwordHash = hashPassword(password);
	delete user.resetTokenHash;
	delete user.resetExpires;
	const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
	fs.writeFileSync(tmp, JSON.stringify(registry, null, "\t") + "\n", { mode: 0o600 });
	fs.renameSync(tmp, file);
	return id;
}
