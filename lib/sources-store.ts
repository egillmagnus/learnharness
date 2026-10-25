/**
 * Course sources (fork addition, 2026-10-24): a plain folder tree the
 * learner fills from the Sources page — LH_SOURCES_DIR/<course>/<files>.
 * The agent's file tools read the same folder (it sits inside
 * LH_FILES_ROOT), so "teach me chapter 2 of <course>" just works.
 * Off unless LH_SOURCES_DIR is set, or multi-user (each user's
 * sourcesDir — user-context.ts).
 *
 * Every name that reaches the filesystem goes through courseName() or
 * fileName(), and every resolved path is checked (symlinks followed) to
 * stay inside the root.
 */
import { realpathSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { requireUser } from "@/user-context";

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // matches the proxy's client_max_body_size

export interface SourceFile {
	/** Path relative to the course folder, "/"-separated. */
	path: string;
	size: number;
	modified: string;
}

export interface Course {
	name: string;
	files: SourceFile[];
}

export class SourcesError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
	}
}

export function sourcesRoot(): string | undefined {
	return requireUser("sources dir")?.sourcesDir ?? (process.env.LH_SOURCES_DIR || undefined);
}

function requireRoot(): string {
	const root = sourcesRoot();
	if (!root) throw new SourcesError("Sources are not enabled (LH_SOURCES_DIR is unset).", 404);
	return root;
}

const SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N} ._()+,&'-]*$/u;

/** A course folder name: letters, digits, spaces and light punctuation. */
export function courseName(raw: unknown): string {
	const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
	if (!name || name.length > 80 || !SEGMENT.test(name)) {
		throw new SourcesError("Course names use letters, digits, spaces and . _ - ( ) only (max 80).");
	}
	return name;
}

/** An uploaded file's name, made safe instead of refused: the browser
 *  sends whatever the learner's file is called. */
export function fileName(raw: string): string {
	const base = raw.split(/[\\/]/).pop() ?? "";
	const cleaned = base
		.normalize("NFC")
		.replace(/[^\p{L}\p{N} ._()+,&'-]/gu, "_")
		.replace(/^[^\p{L}\p{N}]+/u, "")
		.slice(0, 120)
		.trim();
	return cleaned || "file";
}

/** A listed file's relative path. Files copied in by hand may have any
 *  name, so segments are only checked for traversal; assertInside() is
 *  the real fence. */
function relativePath(raw: unknown): string {
	const rel = typeof raw === "string" ? raw : "";
	const parts = rel.split("/");
	if (!rel || parts.some((p) => !p || p === "." || p === ".." || p.includes("\0") || p.includes("\\"))) {
		throw new SourcesError("Invalid file path.");
	}
	return parts.join(path.sep);
}

function realOrResolved(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		return path.resolve(p);
	}
}

function assertInside(root: string, target: string): string {
	const rel = path.relative(realOrResolved(root), realOrResolved(target));
	if (rel.startsWith("..") || path.isAbsolute(rel)) throw new SourcesError("Path is outside the sources folder.");
	return target;
}

function courseDir(course: unknown): string {
	const root = requireRoot();
	return assertInside(root, path.join(root, courseName(course)));
}

export function sourceFilePath(course: unknown, rel: unknown): string {
	const dir = courseDir(course);
	return assertInside(dir, path.join(dir, relativePath(rel)));
}

async function walk(dir: string, prefix: string, out: SourceFile[]): Promise<void> {
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			await walk(full, rel, out);
		} else if (entry.isFile()) {
			const stat = await fs.stat(full);
			out.push({ path: rel, size: stat.size, modified: stat.mtime.toISOString() });
		}
	}
}

export async function listCourses(): Promise<Course[]> {
	const root = requireRoot();
	await fs.mkdir(root, { recursive: true });
	const courses: Course[] = [];
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const files: SourceFile[] = [];
		await walk(path.join(root, entry.name), "", files);
		files.sort((a, b) => a.path.localeCompare(b.path));
		courses.push({ name: entry.name, files });
	}
	return courses.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCourse(course: unknown): Promise<string> {
	const dir = courseDir(course);
	await fs.mkdir(dir, { recursive: true });
	return path.basename(dir);
}

/** Saves into the course folder; a name that's taken gets " (2)", " (3)", … */
export async function saveFile(course: unknown, name: string, bytes: Uint8Array): Promise<string> {
	if (bytes.byteLength > MAX_FILE_BYTES) throw new SourcesError(`${name} is over 50 MB.`, 413);
	const dir = courseDir(course);
	await fs.mkdir(dir, { recursive: true });
	const safe = fileName(name);
	const ext = path.extname(safe);
	const stem = safe.slice(0, safe.length - ext.length);
	for (let n = 1; n < 1000; n++) {
		const candidate = n === 1 ? safe : `${stem} (${n})${ext}`;
		try {
			await fs.writeFile(path.join(dir, candidate), bytes, { flag: "wx", mode: 0o644 });
			return candidate;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	throw new SourcesError(`Too many files named ${safe}.`);
}

export async function deleteFile(course: unknown, rel: unknown): Promise<void> {
	const file = sourceFilePath(course, rel);
	const stat = await fs.lstat(file).catch(() => undefined);
	if (!stat?.isFile()) throw new SourcesError("No such file.", 404);
	await fs.unlink(file);
}

/** Only an empty course can go, so a misclick never takes files with it. */
export async function deleteCourse(course: unknown): Promise<void> {
	const dir = courseDir(course);
	const files: SourceFile[] = [];
	await walk(dir, "", files).catch(() => {
		throw new SourcesError("No such course.", 404);
	});
	if (files.length > 0) throw new SourcesError("Delete the course's files first.", 409);
	await fs.rm(dir, { recursive: true });
}

const INLINE_TYPES: Record<string, string> = {
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".txt": "text/plain; charset=utf-8",
	".md": "text/plain; charset=utf-8",
	".csv": "text/plain; charset=utf-8",
};

/** Types safe to show in the browser; anything else (HTML, SVG, …) is a
 *  download, so an uploaded page can never run on this origin. */
export function contentTypeFor(file: string): { type: string; inline: boolean } {
	const type = INLINE_TYPES[path.extname(file).toLowerCase()];
	return type ? { type, inline: true } : { type: "application/octet-stream", inline: false };
}
