/**
 * GET /api/sources/file?course=&path= — one source file (fork addition,
 * 2026-10-24). PDFs, images and plain text open in the browser; every
 * other type downloads under a sandbox CSP, so nothing uploaded can run
 * scripts on this origin.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { contentTypeFor, SourcesError, sourceFilePath } from "@/lib/sources-store";
import { withUser } from "@/lib/with-user";

export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
	const params = new URL(req.url).searchParams;
	let file: string;
	try {
		file = sourceFilePath(params.get("course"), params.get("path"));
	} catch (error) {
		const status = error instanceof SourcesError ? error.status : 400;
		return Response.json({ error: (error as Error).message }, { status });
	}
	let bytes: Buffer;
	try {
		bytes = await readFile(file);
	} catch {
		return Response.json({ error: "No such file." }, { status: 404 });
	}
	const { type, inline } = contentTypeFor(file);
	const name = encodeURIComponent(path.basename(file));
	return new Response(new Uint8Array(bytes), {
		headers: {
			"content-type": type,
			"content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
			"x-content-type-options": "nosniff",
			// Chrome's PDF viewer refuses to render under a sandbox CSP, and the
			// inline types are inert anyway (nosniff + a fixed type).
			...(inline ? {} : { "content-security-policy": "sandbox" }),
			"cache-control": "private, no-store",
		},
	});
}

// Fork addition (2026-10-24): runs as the signed-in user (lib/with-user.ts).
export const GET = withUser(handleGET);
