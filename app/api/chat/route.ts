import { handleChatRequest } from "@/src/server";
import { withUser } from "@/lib/with-user";

async function handlePOST(req: Request) {
	return handleChatRequest(req);
}

// Fork addition (2026-10-24): runs as the signed-in user (lib/with-user.ts).
export const POST = withUser(handlePOST);
