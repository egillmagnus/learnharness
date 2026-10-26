import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	earlierTranscriptStart, transcriptAnchorStart, transcriptStartBefore,
} from "../src/core/session-navigation.ts";
import type { LhViewMessage } from "../src/core/view.ts";

const user = (id: string): LhViewMessage => ({ id, role: "user", parts: [{ type: "text", text: id }] });
const teacher = (id: string, n: number): LhViewMessage => ({
	id,
	role: "assistant",
	parts: Array.from({ length: n }, (_, i) =>
		i % 3 === 0 ? { type: "step-start" } : { type: "text", id: `${id}-t${i}`, text: `p${i}` }),
});

describe("transcript window (owner, 2026-10-26)", () => {
	it("starts inside a long teacher group, counting no step hairlines", () => {
		const view = [user("u1"), teacher("a1", 60)];
		// 60 parts, every third a step-start: 24 counted parts span 36 parts.
		assert.deepEqual(earlierTranscriptStart(view), { message: 1, part: 25 });
	});

	it("pages upward from the current start and stops at the top", () => {
		const view = [user("u1"), teacher("a1", 60)];
		const next = earlierTranscriptStart(view, { message: 1, part: 25 });
		assert.deepEqual(next, { message: 0, part: 0 });
		assert.deepEqual(earlierTranscriptStart(view, next), { message: 0, part: 0 });
	});

	it("shows a short session whole", () => {
		assert.deepEqual(earlierTranscriptStart([user("u1"), teacher("a1", 6)]), { message: 0, part: 0 });
		assert.deepEqual(earlierTranscriptStart([]), { message: 0, part: 0 });
	});

	it("never cuts a user message", () => {
		const twoPart: LhViewMessage = { id: "u2", role: "user", parts: [{ type: "data-graph-context" }, { type: "text", text: "x" }] };
		assert.deepEqual(earlierTranscriptStart([teacher("a1", 6), twoPart], undefined, 1), { message: 1, part: 0 });
	});

	it("finds a message anchor's part", () => {
		const view = [user("u1"), teacher("a1", 6), user("u2"), teacher("a2", 6)];
		assert.deepEqual(transcriptAnchorStart(view, "a2"), { message: 3, part: 1 });
		assert.equal(transcriptAnchorStart(view, "gone"), null);
	});

	it("orders starts", () => {
		assert.equal(transcriptStartBefore({ message: 1, part: 5 }, { message: 2, part: 0 }), true);
		assert.equal(transcriptStartBefore({ message: 2, part: 3 }, { message: 2, part: 3 }), false);
	});
});
