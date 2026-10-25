import { notFound } from "next/navigation";
import { Chat } from "@/components/chat";
import { slotsConfigured } from "@/src/core";
import { compactionInFlight, getChat, isTurnRunning, readSettingsRecord } from "@/src/server";
import { asPageUser } from "@/lib/with-user";

export const dynamic = "force-dynamic";

export default async function ChatPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ prompt?: string }>;
}) {
	const [{ id }, { prompt }] = await Promise.all([params, searchParams]);
	// Multi-user (fork addition): every read runs as the signed-in user.
	const { chat, record, inFlight, compacting } = await asPageUser(() => {
		const chat = getChat(id);
		// The persistent setup CTA's seed (BYOK, owner 2026-09-22): slotsConfigured
		// over the settings record, server-read — the same gate home/new read. The
		// server's 503 stays the truth; this only decides whether the pill rides.
		const record = readSettingsRecord();
		return {
			chat,
			record,
			inFlight: chat ? isTurnRunning(chat.id) : false,
			compacting: chat ? compactionInFlight(chat.id) : false,
		};
	});
	if (!chat) notFound();
	return (
		<Chat
			key={chat.id}
			chatId={chat.id}
			title={chat.title}
			kind={chat.kind ?? "teach"}
			// Wave D: the record IS native agent history — the client view is
				// derived app-side (core/view.ts projectView; GET serves the same
				// native messages).
				initialMessages={chat.messages}
			initialConfigured={slotsConfigured(record?.models)}
			initialPrompt={prompt}
			// A teacher turn that outlived its client: the remounted view must
			// attach (busy shimmer + poll), never resurrect the stale record.
			initiallyInFlight={inFlight}
			initiallyCompacting={compacting}
		/>
	);
}
