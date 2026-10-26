import type { GraphNode } from "./contracts/graph.ts";
import type { LhViewMessage } from "./view.ts";

/** Message-granular graph links (owner, 2026-10-13). Persisted provenance and
 * native IDs already carry everything needed; only the render seam is new. */
export function messageAnchorId(messageId: string): string {
	return `message-${messageId}`;
}

export function messageIdFromHash(hash: string): string | null {
	try {
		const anchor = decodeURIComponent(hash.replace(/^#/, ""));
		return anchor.startsWith("message-") && anchor.length > "message-".length
			? anchor.slice("message-".length)
			: null;
	} catch {
		return null;
	}
}

/** Old empty anchors do not mask a later real one. Ledger order, not date or
 * lexical order, selects the FIRST recorded message in this source. */
export function propositionSessionHref(node: Pick<GraphNode, "provenance">, chatId: string): string {
	const messageId = node.provenance.find((p) => p.chatId === chatId && p.messageId !== "")?.messageId;
	return `/chat/${encodeURIComponent(chatId)}${messageId ? `#${encodeURIComponent(messageAnchorId(messageId))}` : ""}`;
}

/** projectView's text-part identity is <native message ID>-t<text index>.
 * Assistant GROUP IDs cannot identify an individual extraction source. */
export function textPartMessageId(partId: string | undefined): string | null {
	return partId?.match(/^(.*)-t\d+$/)?.[1] || null;
}

/** One DOM anchor per native teacher message, at its first non-empty prose
 * block. Empty text blocks and intervening tools/thinking do not steal it. */
export function firstSourceTextParts(messages: readonly LhViewMessage[]): Map<string, string> {
	const first = new Map<string, string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.parts) {
			if (part.type !== "text" || typeof part.text !== "string" || !part.text.trim() || !part.id) continue;
			const messageId = textPartMessageId(part.id);
			if (messageId && !first.has(messageId)) first.set(messageId, part.id);
		}
	}
	return first;
}

/** Long sessions render their tail first and grow upward as the reader
 * scrolls (owner, 2026-10-26): a 1.6 MB session server-rendered in ~3.6 s
 * with every part on the page. Teacher groups hold whole teaching runs
 * (100+ parts), so the window is part-granular: messages before `message`,
 * and that message's parts before `part`, are not rendered. */
export interface TranscriptStart {
	message: number;
	part: number;
}

export const TRANSCRIPT_PAGE = 24;

/** The start that shows `budget` more parts above `from` (default: the
 * session's end). Step hairlines don't count; a user message is never cut. */
export function earlierTranscriptStart(
	messages: readonly LhViewMessage[],
	from: TranscriptStart = { message: messages.length, part: 0 },
	budget = TRANSCRIPT_PAGE,
): TranscriptStart {
	let { message, part } = from;
	let left = budget;
	for (;;) {
		if (part > 0) {
			part--;
			if (messages[message]!.parts[part]!.type !== "step-start") left--;
			if (left <= 0) return { message, part: messages[message]!.role === "user" ? 0 : part };
		} else if (message === 0) {
			return { message: 0, part: 0 };
		} else {
			message--;
			part = messages[message]!.parts.length;
		}
	}
}

/** Where a message anchor (#message-<native id>) sits in the view. */
export function transcriptAnchorStart(messages: readonly LhViewMessage[], messageId: string): TranscriptStart | null {
	for (let mi = 0; mi < messages.length; mi++) {
		const pi = messages[mi]!.parts.findIndex((p) => p.type === "text" && textPartMessageId(p.id) === messageId);
		if (pi >= 0) return { message: mi, part: pi };
	}
	return null;
}

export function transcriptStartBefore(a: TranscriptStart, b: TranscriptStart): boolean {
	return a.message < b.message || (a.message === b.message && a.part < b.part);
}
