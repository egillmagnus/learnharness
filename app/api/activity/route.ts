/**
 * GET /api/activity — the dock's one poll: every running background
 * process, every view (chat, home, everywhere). Composition only — the
 * feed lives in server/observability.ts; cost folds client-side via
 * core/prices.ts. See that module's header for why /api/jobs stays
 * chat-scoped and untouched.
 */
import { activityFeed } from "@/src/server";
import { withUser } from "@/lib/with-user";

export const dynamic = "force-dynamic";

async function handleGET() {
	return Response.json(activityFeed());
}

// Fork addition (2026-10-24): runs as the signed-in user (lib/with-user.ts).
export const GET = withUser(handleGET);
