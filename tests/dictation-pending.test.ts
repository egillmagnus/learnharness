/**
 * The stored dictation transcript (owner, 2026-10-26): iOS can kill a
 * backgrounded PWA mid-run; the finals mirrored to localStorage are
 * delivered when the same page mounts again.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pendingDictationFor } from "../components/dictation.tsx";

const raw = (o: unknown) => JSON.stringify(o);

describe("pendingDictationFor", () => {
	it("delivers a recent transcript to the page it was spoken on", () => {
		assert.equal(pendingDictationFor(raw({ path: "/chat/a", text: "so the least fixed point", at: 1000 }), "/chat/a", 5000), "so the least fixed point");
	});

	it("leaves another page's transcript alone", () => {
		assert.equal(pendingDictationFor(raw({ path: "/chat/a", text: "x", at: 1000 }), "/chat/b", 5000), null);
	});

	it("drops a transcript older than a day", () => {
		assert.equal(pendingDictationFor(raw({ path: "/chat/a", text: "x", at: 0 }), "/chat/a", 25 * 60 * 60_000), null);
	});

	it("ignores empty or malformed storage", () => {
		assert.equal(pendingDictationFor(null, "/chat/a", 0), null);
		assert.equal(pendingDictationFor("{not json", "/chat/a", 0), null);
		assert.equal(pendingDictationFor(raw({ path: "/chat/a", text: "", at: 0 }), "/chat/a", 0), null);
	});
});
