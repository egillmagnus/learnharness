import { graphView } from "@/src/server";
import { withUser } from "@/lib/with-user";

/**
 * The home graph view's data endpoint (W4; vision §1 "Home page") — thin
 * transport: the server entry (src/server/graph.ts) returns nodes, edges,
 * session provenance, and per-session understanding observations.
 */

export const dynamic = "force-dynamic";

async function handleGET() {
	return Response.json(graphView());
}

// Fork addition (2026-10-24): runs as the signed-in user (lib/with-user.ts).
export const GET = withUser(handleGET);
