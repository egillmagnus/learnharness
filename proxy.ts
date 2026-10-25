/**
 * The login gate (fork addition, 2026-10-24) — see lib/login-gate.ts.
 * Inert unless LH_LOGIN_PASSWORD_HASH or LH_USERS_FILE is set. Proxy
 * redirects must be absolute; nextUrl takes its host from the forwarded
 * headers. Multi-user, the cookie's user rides to the handlers as
 * USER_HEADER (lib/with-user.ts); a client-sent copy is always dropped.
 */
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, gateEnabled, tokenUser, USER_HEADER } from "@/lib/login-gate";

// The home-screen manifest and icons: iOS fetches them while adding the
// app, possibly without the session cookie.
const OPEN_PATHS = new Set([
	"/login",
	"/logout",
	"/set-password",
	"/manifest.webmanifest",
	"/apple-icon.png",
	"/icon.png",
	"/icon-192.png",
	"/icon-512.png",
]);

export function proxy(request: NextRequest) {
	const forwarded = new Headers(request.headers);
	forwarded.delete(USER_HEADER);
	const pass = () => NextResponse.next({ request: { headers: forwarded } });

	if (!gateEnabled()) return pass();
	const { pathname, search } = request.nextUrl;
	if (OPEN_PATHS.has(pathname)) return pass();
	const user = tokenUser(request.cookies.get(COOKIE)?.value);
	if (user !== null) {
		if (user) forwarded.set(USER_HEADER, user);
		return pass();
	}

	if (pathname.startsWith("/api/")) {
		return Response.json({ error: "not signed in" }, { status: 401 });
	}
	const login = request.nextUrl.clone();
	login.pathname = "/login";
	login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
	return NextResponse.redirect(login);
}

export const config = {
	// Build assets carry no user data; everything else is gated.
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
