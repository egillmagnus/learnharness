/**
 * The login gate (fork addition, 2026-10-24) — see lib/login-gate.ts.
 * Inert unless LH_LOGIN_PASSWORD_HASH is set. Redirects use relative
 * Location headers: behind a reverse proxy request.url is the internal
 * address, not the one the browser used.
 */
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, gateEnabled, validToken } from "@/lib/login-gate";

const OPEN_PATHS = new Set(["/login", "/logout"]);

export function proxy(request: NextRequest) {
	if (!gateEnabled()) return NextResponse.next();
	const { pathname, search } = request.nextUrl;
	if (OPEN_PATHS.has(pathname)) return NextResponse.next();
	if (validToken(request.cookies.get(COOKIE)?.value)) return NextResponse.next();

	if (pathname.startsWith("/api/")) {
		return Response.json({ error: "not signed in" }, { status: 401 });
	}
	const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
	return new Response(null, { status: 307, headers: { location: `/login${next}` } });
}

export const config = {
	// Build assets carry no user data; everything else is gated.
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
