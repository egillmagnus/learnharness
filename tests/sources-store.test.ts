/**
 * The course-sources store (fork addition, 2026-10-24): names are made
 * safe or refused, every path stays inside LH_SOURCES_DIR (symlinks
 * included), taken names get " (2)", and a course only goes when empty.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-sources-"));
const ROOT = path.join(TMP, "courses");
const OUTSIDE = path.join(TMP, "outside");
fs.mkdirSync(OUTSIDE);
fs.writeFileSync(path.join(OUTSIDE, "secret.txt"), "secret");
process.env.LH_SOURCES_DIR = ROOT;

const store = await import("../lib/sources-store.ts");

after(() => {
	fs.rmSync(TMP, { recursive: true, force: true });
});

const bytes = (s: string) => new TextEncoder().encode(s);

describe("sources store", () => {
	it("creates courses and lists their files", async () => {
		assert.equal(await store.createCourse("  STÆ203  Línuleg algebra "), "STÆ203 Línuleg algebra");
		await store.saveFile("STÆ203 Línuleg algebra", "kafli 1.pdf", bytes("pdf"));
		const courses = await store.listCourses();
		assert.deepEqual(
			courses.map((c) => [c.name, c.files.map((f) => f.path)]),
			[["STÆ203 Línuleg algebra", ["kafli 1.pdf"]]],
		);
	});

	it("refuses unsafe course names", async () => {
		for (const bad of ["", "..", "../outside", "a/b", ".hidden", "x".repeat(81), 42]) {
			await assert.rejects(store.createCourse(bad), store.SourcesError, String(bad));
		}
	});

	it("makes uploaded file names safe instead of refusing them", () => {
		assert.equal(store.fileName("../../etc/passwd"), "passwd");
		assert.equal(store.fileName("C:\\Users\\x\\notes.md"), "notes.md");
		assert.equal(store.fileName(".bashrc"), "bashrc");
		assert.equal(store.fileName("a<b>:c?.pdf"), "a_b__c_.pdf");
		assert.equal(store.fileName("..."), "file");
	});

	it("numbers a taken name instead of overwriting", async () => {
		await store.createCourse("dup");
		assert.equal(await store.saveFile("dup", "notes.md", bytes("one")), "notes.md");
		assert.equal(await store.saveFile("dup", "notes.md", bytes("two")), "notes (2).md");
		assert.equal(fs.readFileSync(path.join(ROOT, "dup", "notes.md"), "utf8"), "one");
	});

	it("keeps every file path inside the root", async () => {
		await store.createCourse("fence");
		fs.symlinkSync(OUTSIDE, path.join(ROOT, "fence", "link"));
		fs.symlinkSync(OUTSIDE, path.join(ROOT, "escape"));
		for (const [course, rel] of [
			["fence", "../dup/notes.md"],
			["fence", ".."],
			["fence", "/etc/passwd"],
			["fence", "link/secret.txt"],
			["escape", "secret.txt"],
		]) {
			assert.throws(() => store.sourceFilePath(course, rel), store.SourcesError, `${course}/${rel}`);
		}
		assert.equal(store.sourceFilePath("dup", "notes.md"), path.join(ROOT, "dup", "notes.md"));
	});

	it("deletes files, and a course only when empty", async () => {
		await store.createCourse("gone");
		await store.saveFile("gone", "a.txt", bytes("a"));
		await assert.rejects(store.deleteCourse("gone"), /files first/);
		await store.deleteFile("gone", "a.txt");
		await store.deleteCourse("gone");
		assert.equal(fs.existsSync(path.join(ROOT, "gone")), false);
		await assert.rejects(store.deleteFile("dup", "missing.md"), /No such file/);
	});

	it("serves only inert types inline", () => {
		assert.deepEqual(store.contentTypeFor("a.PDF"), { type: "application/pdf", inline: true });
		assert.equal(store.contentTypeFor("page.html").inline, false);
		assert.equal(store.contentTypeFor("pic.svg").inline, false);
	});
});
