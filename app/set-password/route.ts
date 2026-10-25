/**
 * GET /set-password?token=… — the new-password form for a one-time link;
 * POST — set the password, burn the link and sign the user in (fork
 * addition, 2026-10-25; links come from scripts/password-link.mjs, the
 * token logic is lib/password-reset.ts). Plain HTML like /login.
 */
import { COOKIE, issueToken, REMEMBER_MS } from "@/lib/login-gate";
import { MIN_PASSWORD_LENGTH, resetTokenUser, setPasswordWithToken } from "@/lib/password-reset";

export const dynamic = "force-dynamic";

// Per-client failure budget, as on /login: guessing tokens is pointless
// (192 random bits), but a bad link shouldn't hammer the users file.
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; since: number }>();

function clientId(req: Request): string {
	return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(body: string, status = 200): Response {
	const html = `<!doctype html>
<html lang="en" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Set password · Learning Harness</title>
<style>
	:root { color-scheme: dark; }
	body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #0b0b0c; color: #e8e8ea;
		font: 15px/1.5 ui-monospace, "JetBrains Mono", monospace; }
	form, .msg { width: min(320px, calc(100vw - 32px)); display: grid; gap: 14px; }
	h1 { font: 600 20px/1.2 Georgia, serif; margin: 0 0 6px; }
	input[type=password] { padding: 10px 12px; border-radius: 8px; border: 1px solid #333; background: #141416; color: inherit; font: inherit; font-size: 16px; }
	input:focus { outline: 2px solid #6b8afd; outline-offset: 1px; }
	button { padding: 10px; border: 0; border-radius: 8px; background: #e8e8ea; color: #0b0b0c; font: inherit; font-weight: 600; cursor: pointer; }
	p { margin: 0; color: #b4b4b8; }
	.err { color: #ff7b72; }
	a { color: #e8e8ea; }
</style></head>
<body>${body}</body></html>`;
	return new Response(html, {
		status,
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
	});
}

const expired = () =>
	page(`<div class="msg"><h1>Link expired</h1><p>This link has expired or was already used. Ask for a new one.</p><p><a href="/login">Sign in</a></p></div>`, 410);

function form(token: string, user: string, error?: string, status = 200): Response {
	return page(
		`<form method="post" action="/set-password">
	<h1>Set your password</h1>
	<p>Signing in as <strong>${escapeHtml(user)}</strong>. At least ${MIN_PASSWORD_LENGTH} characters.</p>
	${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
	<input type="password" name="password" placeholder="New password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" autofocus required>
	<input type="password" name="confirm" placeholder="Repeat it" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
	<input type="hidden" name="token" value="${escapeHtml(token)}">
	<button type="submit">Save and sign in</button>
</form>`,
		status,
	);
}

export async function GET(req: Request) {
	const token = new URL(req.url).searchParams.get("token") ?? "";
	const user = resetTokenUser(token);
	return user ? form(token, user) : expired();
}

export async function POST(req: Request) {
	const id = clientId(req);
	const now = Date.now();
	const record = failures.get(id);
	if (record && now - record.since > WINDOW_MS) failures.delete(id);
	if ((failures.get(id)?.count ?? 0) >= MAX_FAILS) {
		return page(`<div class="msg"><p class="err">Too many attempts. Try again in 15 minutes.</p></div>`, 429);
	}

	const data = await req.formData();
	const token = String(data.get("token") ?? "");
	const password = String(data.get("password") ?? "");
	const user = resetTokenUser(token, now);
	if (!user) {
		const r = failures.get(id) ?? { count: 0, since: now };
		r.count += 1;
		failures.set(id, r);
		return expired();
	}
	if (password.length < MIN_PASSWORD_LENGTH) return form(token, user, `Use at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
	if (password !== String(data.get("confirm") ?? "")) return form(token, user, "The two passwords don't match.", 400);
	if (setPasswordWithToken(token, password, now) !== user) return expired();

	failures.delete(id);
	const session = issueToken(true, user, now);
	const secure = req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
	const cookie = [
		`${COOKIE}=${session.value}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		secure ? "Secure" : "",
		`Max-Age=${Math.floor(REMEMBER_MS / 1000)}`,
	].filter(Boolean).join("; ");
	return new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie } });
}
