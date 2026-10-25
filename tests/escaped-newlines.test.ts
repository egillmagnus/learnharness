/** Double-escaped newlines in tool arguments (fork addition, 2026-10-25 —
 *  restoreEscapedNewlines in src/core/math-delims.ts): a one-line question
 *  with literal `\n` text gets its line breaks back; math and real
 *  multi-line text stay untouched. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repairMathForDisplay, restoreEscapedNewlines } from "../src/core/index.ts";

describe("restoreEscapedNewlines", () => {
	it("restores a double-escaped question with a code fence", () => {
		const raw = String.raw`A sign analysis runs on:\n\n` + "```java" + String.raw`\nif (c) { x = 3; }\nint z = 10 / x;\n` + "```" + String.raw`\n\nWhat holds for $x$?`;
		assert.equal(
			restoreEscapedNewlines(raw),
			"A sign analysis runs on:\n\n```java\nif (c) { x = 3; }\nint z = 10 / x;\n```\n\nWhat holds for $x$?",
		);
	});

	it("leaves math commands alone", () => {
		const raw = String.raw`Is $x \neq y$?\n\nAnd \(\nabla f\)?`;
		assert.equal(restoreEscapedNewlines(raw), "Is $x \\neq y$?\n\nAnd \\(\\nabla f\\)?");
		assert.equal(repairMathForDisplay(String.raw`Is $x \neq y$?`), String.raw`Is $x \neq y$?`);
	});

	it("does nothing without a clear double-escape", () => {
		for (const s of [String.raw`printf("\n")`, "one\ntwo \\n\\n", String.raw`a \\n\\n b`]) {
			assert.equal(restoreEscapedNewlines(s), s);
		}
	});
});

describe("doubled set braces", () => {
	it("heals \\\\{ \\\\} in plain inline math", () => {
		const raw = String.raw`Concrete state: $x \\in \\{3, 7\\}$.`;
		assert.equal(repairMathForDisplay(raw), String.raw`Concrete state: $x \in \{3, 7\}$.`);
	});

	it("keeps row breaks before braces inside environments", () => {
		const raw = String.raw`$\begin{pmatrix}a \\{b}\end{pmatrix}$`;
		assert.equal(repairMathForDisplay(raw), raw);
	});
});
