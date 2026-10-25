import { modelCatalog } from "@/src/server";
import { withUser } from "@/lib/with-user";

/**
 * The model picker's data (model-control wave): pi-ai's configured-provider
 * catalog as client-safe DTOs — id/name/cost/context/modality plus each
 * model's SUPPORTED thinking levels (per its thinkingLevelMap). Static
 * catalog: no network, stable within a pi-ai version.
 */
async function handleGET() {
	return Response.json(modelCatalog());
}

// Fork addition (2026-10-24): runs as the signed-in user (lib/with-user.ts).
export const GET = withUser(handleGET);
