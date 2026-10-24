/**
 * The Sources page's transport (fork addition, 2026-10-24) — see
 * lib/sources-store.ts.
 *
 * GET: every course and its files. POST (multipart: "course", "files"*):
 * creates the course and saves the files; no files = just the course.
 * DELETE ?course=&path=: one file; ?course= alone: the course, if empty.
 */
import {
	createCourse,
	deleteCourse,
	deleteFile,
	listCourses,
	MAX_FILE_BYTES,
	saveFile,
	SourcesError,
	sourcesRoot,
} from "@/lib/sources-store";

export const dynamic = "force-dynamic";

function failure(error: unknown): Response {
	if (error instanceof SourcesError) return Response.json({ error: error.message }, { status: error.status });
	console.error("[sources]", error);
	return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
}

export async function GET() {
	if (!sourcesRoot()) return Response.json({ enabled: false, courses: [] });
	try {
		return Response.json({ enabled: true, courses: await listCourses() });
	} catch (error) {
		return failure(error);
	}
}

export async function POST(req: Request) {
	let form: FormData;
	try {
		form = await req.formData();
	} catch {
		return Response.json({ error: "Expected a multipart form." }, { status: 400 });
	}
	try {
		const course = await createCourse(form.get("course"));
		const files = form.getAll("files").filter((f): f is File => f instanceof File);
		const saved: string[] = [];
		for (const file of files) {
			if (file.size > MAX_FILE_BYTES) throw new SourcesError(`${file.name} is over 50 MB.`, 413);
			saved.push(await saveFile(course, file.name, new Uint8Array(await file.arrayBuffer())));
		}
		return Response.json({ course, saved });
	} catch (error) {
		return failure(error);
	}
}

export async function DELETE(req: Request) {
	const params = new URL(req.url).searchParams;
	try {
		const file = params.get("path");
		if (file) await deleteFile(params.get("course"), file);
		else await deleteCourse(params.get("course"));
		return Response.json({ ok: true });
	} catch (error) {
		return failure(error);
	}
}
