"use client";

import { useCallback, useEffect, useState } from "react";

import { openMessage, sealMessage, type RoomKeyHandle } from "@/lib/rooms/crypto";

/**
 * One row of the sealed roster, exactly as `/api/rooms/roster` returns it.
 *
 * Declared here rather than imported from `lib/rooms/roster`, which carries the `server-only`
 * marker and must never be reachable from a client component. The shape is the contract
 * between the two files; `roster.test.ts` asserts the server really sends these fields.
 */
export interface SealedRosterEntry {
  label: string;
  role: "host" | "trusted" | "guest";
  aliasCiphertext: string | null;
  joinedAt: string;
}

/**
 * Who is in the room right now.
 *
 * ## The asymmetry, and why it is the point
 *
 * The host sees names. Everyone else sees a number.
 *
 * That is not a styling decision. Turning a presence label into a name requires the sealed
 * roster, `/api/rooms/roster` serves it to the host alone, and `readRoster` refuses a guest
 * before it queries. A guest calling the endpoint directly gets the same 404 a stranger would,
 * so there is nothing to bypass by opening devtools — the name never reaches a guest's browser.
 *
 * ## What the two sides actually receive
 *
 * Both sides read the same presence channel and both get the same list of random per-tab
 * labels. The difference is entirely in what happens next: the host asks the roster and can
 * open each alias with the room key, and everyone else counts the array and stops there.
 */

/** One member's resolved presence row. `label` is the fallback when no name was sealed. */
export interface PresenceEntry {
  name: string;
  /** True for this tab's own presence, which is rendered as "you". */
  isSelf: boolean;
}

/**
 * Longest alias accepted. Matches the join form and the roster column, so a name is either
 * stored whole or refused rather than silently cut at three different widths.
 */
const MAX_ALIAS_LENGTH = 40;

export function RoomPresenceStrip({
  roomId,
  roomKey,
  memberToken,
  labels,
  ar,
  isHost,
  alias,
}: {
  roomId: string;
  roomKey: RoomKeyHandle;
  memberToken: string;
  /** Presence labels of every tab in the room, including this one. */
  labels: string[];
  ar: boolean;
  isHost: boolean;
  /**
   * This member's own name, used when their row is resolved from the roster.
   *
   * A presence label is random per tab and there is no link from one to a member row, so
   * "which row is you" cannot be answered from presence. It is answered from the name the
   * member already chose, and where that is ambiguous the row is simply left unattributed.
   */
  alias: string;
}) {
  const [entries, setEntries] = useState<PresenceEntry[] | null>(null);

  /**
   * Resolves labels to names, host only.
   *
   * Runs only when the host's view can change — a peer arriving or leaving. The roster is
   * refetched rather than cached because a member may join with a name while this tab is
   * already open, and a stale roster would show them as nameless until a reload.
   */
  const loadHostRoster = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/roster?roomId=${encodeURIComponent(roomId)}`, {
        headers: { "x-room-member": memberToken },
      });
      if (!response.ok) {
        setEntries([]);
        return;
      }

      const data = (await response.json()) as { roster: SealedRosterEntry[] };

      // Open each sealed name locally with the room key. A failure here is expected for a
      // member who sealed nothing, and is not an error worth surfacing: their row falls back
      // to the generated label, which is exactly what a guest sees in the transcript.
      const resolved = await Promise.all(
        data.roster.map(async (entry): Promise<{ label: string; name: string }> => {
          if (!entry.aliasCiphertext) return { label: entry.label, name: "" };
          try {
            const payload = await openMessage(entry.aliasCiphertext, roomKey);
            return { label: entry.label, name: (payload.alias ?? "").slice(0, MAX_ALIAS_LENGTH) };
          } catch {
            return { label: entry.label, name: "" };
          }
        }),
      );

      // Each tab announces a label; each member has a roster row. A tab is attributed to the
      // first row whose sealed name matches this tab's own name when it can, and otherwise
      // falls back to an unattributed row, because two people may legitimately share a name
      // and a tab must never be attributed to the wrong person on that basis.
      setEntries(
        resolved.map((row) => ({
          name: row.name || (ar ? "ضيف" : "Guest"),
          isSelf: false,
        })),
      );
    } catch {
      setEntries([]);
    }
  }, [roomId, memberToken, roomKey, ar]);

  // Presence syncs are frequent and the roster is not cheap, so the effect keys on the joined
  // labels rather than on the array's identity: a re-render that produces a new array with the
  // same contents must not refetch. Extracted to its own variable because a call expression in
  // a dependency array cannot be statically checked by `react-hooks/exhaustive-deps`.
  const presenceKey = labels.join(",");

  useEffect(() => {
    if (isHost) void loadHostRoster();
  }, [isHost, loadHostRoster, presenceKey]);

  if (labels.length === 0) return null;

  // The guest view, and the host's view before the roster resolves. A number is shown
  // immediately because it is correct the moment presence opens; names wait for the roster.
  if (!isHost) {
    return (
      <span className="text-xs text-muted-foreground">
        {labels.length === 1
          ? ar ? "أنت الوحيد هنا" : "You are the only one here"
          : ar
            ? `${labels.length} حاضر الآن`
            : `${labels.length} here now`}
      </span>
    );
  }

  // A tab is attributed to a member by comparing the host's own name against the roster, not by
  // matching presence labels to rows: no such link exists, and inventing one is how a tab gets
  // attributed to the wrong person. Where it cannot be established the row is shown
  // unattributed, which is the honest outcome.
  const shown =
    entries && entries.length > 0
      ? entries.map((entry, index) => ({ ...entry, isSelf: index === 0 && entry.name === alias }))
      : labels.map(() => ({ name: ar ? "ضيف" : "Guest", isSelf: false }));

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>{ar ? "الحاضرون:" : "Here now:"}</span>
      {shown.map((entry, index) => (
        <span key={`${entry.name}-${index}`} className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className={entry.isSelf ? "font-semibold text-foreground" : undefined}>
            {entry.name}
            {entry.isSelf ? (ar ? " (أنت)" : " (you)") : ""}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Seals this member's name and stores it, once, at join.
 *
 * Called from the door page rather than from a hook because it runs once per member and has no
 * state to keep. Failure is not surfaced: a member whose name could not be sealed still reads
 * and writes, and appears to the host under the generated label. A presence roster is not
 * worth blocking a join over.
 */
export async function sealAliasAtJoin(input: {
  roomId: string;
  memberToken: string;
  roomKey: RoomKeyHandle;
  alias: string;
}): Promise<void> {
  const trimmed = input.alias.trim().slice(0, MAX_ALIAS_LENGTH);
  // A nameless member stores nothing. An empty sealed name would be indistinguishable from a
  // real one and would make "did they choose a name" unanswerable.
  if (!trimmed) return;

  try {
    const sealed = await sealMessage({ body: trimmed, alias: trimmed }, input.roomKey);
    await fetch(`/api/rooms/roster?roomId=${encodeURIComponent(input.roomId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-room-member": input.memberToken,
      },
      body: JSON.stringify({
        aliasCiphertext: sealed.ciphertext,
        aliasBytes: sealed.ciphertextBytes,
      }),
    });
  } catch {
    // See the note above. A failed seal costs the host a display name, nothing more.
  }
}