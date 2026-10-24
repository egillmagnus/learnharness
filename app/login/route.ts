/**
 * GET /login — the password form; POST /login — check it and issue the
 * session cookie (fork addition, 2026-10-24; see lib/login-gate.ts).
 * A plain HTML route, outside the app shell, so nothing behind the gate
 * loads before sign-in.
 */
import { checkPassword, COOKIE, gateEnabled, issueToken, REMEMBER_MS, safeNext } from "@/lib/login-gate";

export const dynamic = "force-dynamic";

// Per-client failure budget: MAX_FAILS wrong passwords per WINDOW_MS.
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; since: number }>();

function clientId(req: Request): string {
	return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(next: string, error?: string, status = 200): Response {
	const html = `<!doctype html>
<html lang="en" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Learning Harness</title>
<style>
	:root { color-scheme: dark; }
	body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #0b0b0c; color: #e8e8ea;
		font: 15px/1.5 ui-monospace, "JetBrains Mono", monospace; }
	form { width: min(320px, calc(100vw - 32px)); display: grid; gap: 14px; }
	h1 { font: 600 20px/1.2 Georgia, serif; margin: 0 0 6px; }
	input[type=password] { padding: 10px 12px; border-radius: 8px; border: 1px solid #333; background: #141416; color: inherit; font: inherit; }
	input[type=password]:focus { outline: 2px solid #6b8afd; outline-offset: 1px; }
	label { display: flex; gap: 8px; align-items: center; color: #b4b4b8; }
	button { padding: 10px; border: 0; border-radius: 8px; background: #e8e8ea; color: #0b0b0c; font: inherit; font-weight: 600; cursor: pointer; }
	.err { color: #ff7b72; margin: 0; }
</style></head>
<body><form method="post" action="/login">
	<h1>Learning Harness</h1>
	${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
	<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
	<label><input type="checkbox" name="remember" checked> Remember me on this device</label>
	<input type="hidden" name="next" value="${escapeHtml(next)}">
	<button type="submit">Sign in</button>
</form></body></html>`;
	return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(req: Request) {
	const next = safeNext(new URL(req.url).searchParams.get("next"));
	if (!gateEnabled()) return new Response(null, { status: 303, headers: { location: next } });
	return page(next);
}

export async function POST(req: Request) {
	const form = await req.formData();
	const next = safeNext(String(form.get("next") ?? ""));
	if (!gateEnabled()) return new Response(null, { status: 303, headers: { location: next } });

	const id = clientId(req);
	const now = Date.now();
	const record = failures.get(id);
	if (record && now - record.since > WINDOW_MS) failures.delete(id);
	if ((failures.get(id)?.count ?? 0) >= MAX_FAILS) {
		return page(next, "Too many attempts. Try again in 15 minutes.", 429);
	}

	if (!checkPassword(String(form.get("password") ?? ""))) {
		const r = failures.get(id) ?? { count: 0, since: now };
		r.count += 1;
		failures.set(id, r);
		await new Promise((resolve) => setTimeout(resolve, 600));
		return page(next, "Wrong password.", 401);
	}

	failures.delete(id);
	const remember = form.get("remember") != null;
	const token = issueToken(remember, now);
	const secure = req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
	const cookie = [
		`${COOKIE}=${token.value}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		secure ? "Secure" : "",
		remember ? `Max-Age=${Math.floor(REMEMBER_MS / 1000)}` : "",
	].filter(Boolean).join("; ");
	return new Response(null, { status: 303, headers: { location: next, "set-cookie": cookie } });
}
