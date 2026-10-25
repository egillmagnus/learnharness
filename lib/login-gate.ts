/**
 * Password gate for self-hosted web deploys (fork addition, 2026-10-24).
 *
 * OFF unless LH_LOGIN_PASSWORD_HASH or LH_USERS_FILE is set — the desktop
 * app and `npm run dev` never set them, so they are untouched. When on,
 * proxy.ts admits a request only with a valid session cookie; /login
 * issues one.
 *
 * Two modes:
 *   single user  LH_LOGIN_PASSWORD_HASH — one password, no username.
 *   multi-user   LH_USERS_FILE (user-context.ts) — username + password;
 *                the cookie names the user, and proxy.ts forwards it to
 *                the handlers as the x-lh-user header (lib/with-user.ts).
 *
 * Env:
 *   LH_LOGIN_PASSWORD_HASH  "scrypt$<salt b64>$<hash b64>" — make one with
 *                           `node scripts/hash-password.mjs`
 *   LH_SESSION_SECRET       random string (≥32 chars) signing the cookie;
 *                           rotating it signs every device out
 *
 * Cookie: "[<user>.]<expiry ms>.<HMAC-SHA256(secret, [<user>.]expiry) b64url>".
 * "Remember me" makes it persistent for REMEMBER_MS; otherwise it is a
 * browser-session cookie that also expires server-side after SESSION_MS.
 * A user removed from the users file is signed out on their next request.
 */
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { findUser, multiUser } from "@/user-context";

export const COOKIE = "lh_session";
/** Multi-user: the header proxy.ts forwards the cookie's user in. */
export const USER_HEADER = "x-lh-user";
export const REMEMBER_MS = 180 * 24 * 3600 * 1000;
export const SESSION_MS = 12 * 3600 * 1000;

export function gateEnabled(): boolean {
	return multiUser() || Boolean(process.env.LH_LOGIN_PASSWORD_HASH);
}

function secret(): string {
	const s = process.env.LH_SESSION_SECRET ?? "";
	if (s.length < 32) throw new Error("LH_SESSION_SECRET must be at least 32 characters when the login gate is on");
	return s;
}

function sign(payload: string): string {
	return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** `user` is the signed-in user's id (multi-user) or "" (single user). */
export function issueToken(remember: boolean, user = "", now = Date.now()): { value: string; expires: number } {
	const expires = now + (remember ? REMEMBER_MS : SESSION_MS);
	const payload = user ? `${user}.${expires}` : String(expires);
	return { value: `${payload}.${sign(payload)}`, expires };
}

/** The cookie's user: an id (multi-user), "" (single user), or null when
 *  the cookie is missing, expired, forged or names an unknown user. */
export function tokenUser(value: string | undefined, now = Date.now()): string | null {
	if (!value) return null;
	const parts = value.split(".");
	const multi = multiUser();
	if (parts.length !== (multi ? 3 : 2)) return null;
	const user = multi ? parts[0]! : "";
	const expires = parts[multi ? 1 : 0]!;
	if (!/^\d+$/.test(expires) || Number(expires) <= now) return null;
	const payload = multi ? `${user}.${expires}` : expires;
	const given = Buffer.from(parts[parts.length - 1]!);
	const want = Buffer.from(sign(payload));
	if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
	if (multi && !findUser(user)) return null;
	return user;
}

export function validToken(value: string | undefined, now = Date.now()): boolean {
	return tokenUser(value, now) !== null;
}

function matchesHash(stored: string, password: string): boolean {
	const [scheme, salt, hash] = stored.split("$");
	if (scheme !== "scrypt" || !salt || !hash) return false;
	const want = Buffer.from(hash, "base64");
	const got = scryptSync(password, Buffer.from(salt, "base64"), want.length);
	return timingSafeEqual(got, want);
}

export function checkPassword(password: string): boolean {
	return matchesHash(process.env.LH_LOGIN_PASSWORD_HASH ?? "", password);
}

/** The user these credentials sign in: an id (multi-user), "" (single
 *  user, username ignored), or null. */
export function authenticate(username: string, password: string): string | null {
	if (!multiUser()) return checkPassword(password) ? "" : null;
	const user = findUser(username.trim().toLowerCase());
	return user && matchesHash(user.passwordHash, password) ? user.id : null;
}

/** Same-origin relative path only — never an open redirect. */
export function safeNext(next: string | null | undefined): string {
	return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
