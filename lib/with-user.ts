/**
 * Runs route handlers and server pages as the signed-in user (fork
 * addition, 2026-10-24 — user-context.ts). proxy.ts verifies the session
 * cookie and forwards its user as USER_HEADER, after deleting any copy
 * the client sent, so the header is trustworthy here. Single-user mode
 * passes straight through.
 */
import { headers } from "next/headers";
import { USER_HEADER } from "@/lib/login-gate";
import { findUser, multiUser, runAsUser, type LhUser } from "@/user-context";

function userFrom(value: string | null): LhUser | undefined {
	return value ? findUser(value) : undefined;
}

/** Wrap a route handler: `export const GET = withUser(async (req) => …)`. */
export function withUser<Rest extends unknown[]>(
	handler: (req: Request, ...rest: Rest) => Response | Promise<Response>,
): (req: Request, ...rest: Rest) => Promise<Response> {
	return async (req, ...rest) => {
		if (!multiUser()) return handler(req, ...rest);
		const user = userFrom(req.headers.get(USER_HEADER));
		if (!user) return Response.json({ error: "not signed in" }, { status: 401 });
		return runAsUser(user, () => handler(req, ...rest));
	};
}

/** Run a server page's data reads as the signed-in user. */
export async function asPageUser<T>(read: () => T | Promise<T>): Promise<T> {
	if (!multiUser()) return read();
	const user = userFrom((await headers()).get(USER_HEADER));
	if (!user) throw new Error("[users] page rendered without a signed-in user");
	return runAsUser(user, read);
}
