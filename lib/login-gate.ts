/**
 * Password gate for self-hosted web deploys (fork addition, 2026-10-24).
 *
 * OFF unless LH_LOGIN_PASSWORD_HASH is set — the desktop app and `npm run
 * dev` never set it, so they are untouched. When on, proxy.ts admits a
 * request only with a valid session cookie; /login issues one.
 *
 * Env:
 *   LH_LOGIN_PASSWORD_HASH  "scrypt$<salt b64>$<hash b64>" — make one with
 *                           `node scripts/hash-password.mjs`
 *   LH_SESSION_SECRET       random string (≥32 chars) signing the cookie;
 *                           rotating it signs every device out
 *
 * Cookie: "<expiry ms>.<HMAC-SHA256(secret, expiry) b64url>". "Remember me"
 * makes it persistent for REMEMBER_MS; otherwise it is a browser-session
 * cookie that also expires server-side after SESSION_MS.
 */
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

export const COOKIE = "lh_session";
export const REMEMBER_MS = 180 * 24 * 3600 * 1000;
export const SESSION_MS = 12 * 3600 * 1000;

export function gateEnabled(): boolean {
	return Boolean(process.env.LH_LOGIN_PASSWORD_HASH);
}

function secret(): string {
	const s = process.env.LH_SESSION_SECRET ?? "";
	if (s.length < 32) throw new Error("LH_SESSION_SECRET must be at least 32 characters when the login gate is on");
	return s;
}

function sign(payload: string): string {
	return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueToken(remember: boolean, now = Date.now()): { value: string; expires: number } {
	const expires = now + (remember ? REMEMBER_MS : SESSION_MS);
	return { value: `${expires}.${sign(String(expires))}`, expires };
}

export function validToken(value: string | undefined, now = Date.now()): boolean {
	if (!value) return false;
	const dot = value.indexOf(".");
	if (dot < 1) return false;
	const expires = value.slice(0, dot);
	if (!/^\d+$/.test(expires) || Number(expires) <= now) return false;
	const given = Buffer.from(value.slice(dot + 1));
	const want = Buffer.from(sign(expires));
	return given.length === want.length && timingSafeEqual(given, want);
}

export function checkPassword(password: string): boolean {
	const [scheme, salt, hash] = (process.env.LH_LOGIN_PASSWORD_HASH ?? "").split("$");
	if (scheme !== "scrypt" || !salt || !hash) return false;
	const want = Buffer.from(hash, "base64");
	const got = scryptSync(password, Buffer.from(salt, "base64"), want.length);
	return timingSafeEqual(got, want);
}

/** Same-origin relative path only — never an open redirect. */
export function safeNext(next: string | null | undefined): string {
	return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
