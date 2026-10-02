/**
 * Builds the model request for a room.
 *
 * ## The import wall
 *
 * This module is the boundary that keeps section 1 of the design true: *"The AI reads the
 * room transcript and nothing else. It never reads the host's private conversations, the
 * memory ledger, or any other local data."*
 *
 * That claim is not enforced by a runtime check, because a runtime check on what has
 * already been gathered is a check too late. It is enforced by construction: this file
 * imports nothing from `lib/memory`, nothing from the private chat, nothing from the
 * embedding index, and nothing that reads `localStorage`. Its only import is a type from
 * the AI layer. There is no function here that *could* read the memory ledger, because
 * nothing it can reach holds it.
 *
 * `__tests__/ai-bridge.test.ts` asserts this by building a request for a room and
 * checking the body against private text that shares keywords with the room. Keyword
 * overlap is what makes that test meaningful: if the bridge ever grew a "just a little
 * context from memory", the overlap would be the first thing it dragged in.
 *
 * **Do not add an import here to make a feature easier.** If a request needs something
 * from outside the room, that is a change to the design and belongs in
 * `docs/group-rooms-design.md` first.
 *
 * ## Where this runs
 *
 * In the browser, not on the server. The server stores ciphertext and never holds the
 * room key, so it cannot build this body: only the tab holding the key can. That is why
 * the host's plaintext transcript does reach the API route — the same way every private
 * chat message already does — and why the room key itself never travels.
 */

import type { ChatCompletionMessage } from "@/lib/ai/types";

/**
 * How many room messages are sent to the model.
 *
 * A bound, not a preference. Every message in the window is the host's money, so a room
 * that has run long must not quietly start sending its whole history on every question.
 * The most recent window is also the most useful: a brainstorm's context is what was just
 * said.
 */
export const ROOM_CONTEXT_MESSAGES = 40;

/** Bounds the question itself, matching the per-message limit the chat route enforces. */
const MAX_QUESTION_LENGTH = 4_000;

/** Bounds the topic the host set, which reaches the system prompt. */
const MAX_TOPIC_LENGTH = 500;

/** Bounds a participant alias. These are user-chosen and go into a prompt. */
const MAX_ALIAS_LENGTH = 40;

/**
 * One decrypted room message, as the browser holds it after opening it locally.
 *
 * This is the only shape the bridge accepts. Note what is absent: no memory, no profile,
 * no prior conversations, no embeddings. A caller cannot pass them in even by accident,
 * because there is no field to pass them in.
 */
export interface RoomContextMessage {
  /** Who wrote it, as chosen in the room. Never an account, never an email. */
  alias: string | null;
  body: string;
  /** True for a message the model itself wrote, so it is not fed back as a human turn. */
  isAi: boolean;
}

export interface RoomQuestion {
  /** The room's topic. Encrypted at rest, decrypted here in the host's tab. */
  topic: string;
  /** Decrypted room messages in transcript order, oldest first. */
  messages: RoomContextMessage[];
  /** What the member is asking. */
  question: string;
}

/**
 * Strips control characters, so a message body cannot forge a turn boundary.
 *
 * A participant who pastes a literal two-line block ending in `user:` could
 * otherwise start a new turn inside the transcript and speak as the host. It is
 * the only place room text meets a prompt, so it is handled here rather than
 * trusted to have been cleaned upstream.
 */
function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, max);
}

/**
 * The system prompt.
 *
 * It states only what the room is and who is speaking. It names no host, no account, and
 * no history: everything here is either the room's own topic or a fact about this
 * conversation. The instruction to answer only from the room is deliberate — it is what
 * stops the model volunteering something it "knows" that nobody put in here.
 */
function systemPrompt(topic: string, participantCount: number): ChatCompletionMessage {
  const subject = topic ? `The room is working on: ${clean(topic, MAX_TOPIC_LENGTH)}.` : "";
  return {
    role: "system",
    content: [
      "You are taking part in a group brainstorming session.",
      subject,
      `There are ${participantCount} participant(s) in the room.`,
      "Answer only from the conversation above. Everything you were told about this room is in this message.",
      "If the room has not given you enough to answer, say what is missing and ask for it rather than guessing.",
      "Do not invent facts about the participants, the company, or anything outside this conversation.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * Builds the request the room sends to the model.
 *
 * Takes room data and returns messages. There is no other input, no ambient state, and
 * no default that could widen it — the signature is the whole security boundary.
 */
export function buildRoomRequest(room: RoomQuestion): ChatCompletionMessage[] {
  const question = clean(room.question, MAX_QUESTION_LENGTH);
  if (!question) throw new Error("A question is required");

  // The most recent messages, not the oldest ones. A long room sends its tail, which is
  // both the cheapest and the part a question about what to do next is actually about.
  //
  // Named `recent` rather than `window`: `window` is the browser global, and a local
  // binding that shadows it in a module about never reaching for the browser is a
  // confusing thing to leave behind.
  const recent = room.messages.slice(-ROOM_CONTEXT_MESSAGES);
  const participants = new Set(recent.map((message) => message.alias ?? ""));
  const who = (message: RoomContextMessage) =>
    clean(message.alias ?? "", MAX_ALIAS_LENGTH) || "A participant";

  const turns: ChatCompletionMessage[] = recent.map((message) => ({
    role: "user" as const,
    content: `${who(message)}: ${clean(message.body, MAX_QUESTION_LENGTH)}`,
  }));

  // The model's own answers keep the assistant role rather than impersonating a member.
  // Without this a follow-up question reads its earlier answer as something a human said,
  // and a room that argues with the model ends up arguing with itself.
  for (const [index, message] of recent.entries()) {
    if (message.isAi) {
      turns[index] = { role: "assistant", content: clean(message.body, MAX_QUESTION_LENGTH) };
    }
  }

  return [
    systemPrompt(room.topic, participants.size),
    ...turns,
    { role: "user", content: question },
  ];
}


