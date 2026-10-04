/**
 * The shapes the host's controls consume, duplicated from `lib/rooms/server`.
 *
 * `server.ts` carries the `server-only` marker and must never be reachable from a client
 * component, so the panel cannot import these types from where they are declared. A type is
 * erased at compile time and nothing would actually leak — the duplication is here because the
 * alternative is a client module importing a module it is forbidden to import, and that reads
 * as a hole in the boundary rather than as a pragmatic copy.
 *
 * `settings-route.test.ts` asserts the endpoint really sends these fields, so the copy cannot
 * drift from the original without a test failing.
 */

export interface RoomSpendRow {
  /** The host's six-character label, matching the members panel and the roster. */
  label: string;
  role: "host" | "trusted" | "guest";
  /** How many calls this member made. Never a cost: the server cannot price a provider call. */
  calls: number;
  lastUsedAt: string | null;
}

export interface RoomSpendSummary {
  totalCalls: number;
  callsLastDay: number;
  members: RoomSpendRow[];
  models: { model: string; calls: number }[];
}

/**
 * A model in the room, as any member may address it.
 *
 * Declared here rather than imported from `server.ts` for the reason `RoomSpendSummary` is:
 * that module carries `server-only` and a client cannot import it. `models.test.ts` asserts the
 * endpoint really sends these fields, so the copy cannot drift from the original.
 */
export interface RoomModelTarget {
  /** The public handle a member is named by. Two members may bring the same provider model. */
  slot: string;
  modelId: string;
  modelLabel: string;
  specialty: string;
  /** What the owner agreed. `silent` means the model cannot be addressed at all. */
  sharing: "silent" | "on_request" | "always";
  callLimit: number | null;
  dailyLimit: number | null;
  totalCalls: number;
  callsToday: number;
  isMine: boolean;
}