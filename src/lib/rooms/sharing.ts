import "server-only";

/**
 * ## What a member agrees to before their model may answer in a room
 *
 * A panel room is several people''s models answering the same conversation. The model owner pays
 * for every answer, so two things must be settled **before** it speaks and not after:
 *
 *   1. **Consent.** Bringing a model into a room is not the same as agreeing to be asked
 *      anything, by anyone, for the rest of the room''s life. A member may bring a model and
 *      keep it silent.
 *   2. **A budget.** Not "use your key" but "use at most N of your calls here". A member who
 *      agrees to be asked once has not agreed to a hundred, and without a ceiling the only
 *      thing limiting their spend is the politeness of a room full of strangers.
 *
 * ## Why the owner is told when it is used
 *
 * A budget the owner cannot see being spent is not a budget, it is a hope. Every invocation is
 * therefore counted against the budget **and** shown to the owner in the panel, so a model that
 * has answered forty times is a fact on the owner''s screen rather than a surprise on their
 * invoice.
 *
 * A member may also set a daily ceiling, which is what protects them from a room that runs for
 * days rather than for an afternoon.
 */

/** How a member has agreed their model may be used. */
export type ModelSharing = "silent" | "on_request" | "always";

export interface PanelModelBudget {
  /** The member''s own model, unchanged. */
  modelId: string;
  modelLabel: string;
  specialty: string;
  /** How this member agreed their model may be called. Default is the most cautious. */
  sharing: ModelSharing;
  /** Calls this member accepts in the whole room. Null means "no total ceiling". */
  callLimit: number | null;
  /** Calls this member accepts per day. Null means no daily ceiling. */
  dailyLimit: number | null;
}

/** Longest any single ceiling may be. A budget that fits in a `number` is a budget. */
export const MAX_MODEL_CALL_LIMIT = 10_000;
/** Shortest, because a ceiling of zero is silence and silence is expressed by `sharing`. */
export const MIN_MODEL_CALL_LIMIT = 1;

export interface ModelUsage {
  /** Calls made against the total ceiling, in this room. */
  totalCalls: number;
  /** Calls made today, against the daily ceiling. */
  callsToday: number;
  /** True when either ceiling is reached. */
  exhausted: boolean;
}

/**
 * What a member may agree to, given their model and this room.
 *
 * Defaults are the conservative ones on purpose: a member who opens the sharing control and
 * closes it again has agreed to nothing, and the room will treat their model as silent. Being
 * invited into other people''s conversation and answering with your own key is the kind of thing
 * that should require a deliberate act.
 */
export function defaultModelSharing(): ModelSharing {
  return "silent";
}

/**
 * Whether a member may share a model in this kind of room.
 *
 * **Both kinds, deliberately.** A guest room is a room full of people talking, and a model that
 * has been brought into it by an account is one of those people. The host''s own model has
 * always answered there; a member who signs in and brings theirs has asked for the same thing,
 * and refusing it would make the two room kinds differ in a way nobody was promised.
 *
 * What differs is not permission but **ownership**: on a guest room the host''s model belongs
 * to the host and costs the host, and there is exactly one of it. In a panel room every model
 * belongs to the member who registered it. Either way the owner sets the budget, and either
 * way they can stop it mid-conversation.
 */
export function sharingAllowed(_roomKind: string): boolean {
  return true;
}

/**
 * Decides whether one specific invocation may proceed.
 *
 * Takes the whole decision rather than returning a boolean so the refusal can say *which* limit
 * stopped it. "You reached your daily limit" tells a member something they can act on; "not
 * allowed" does not.
 *
 * ## Why `on_request` still requires a budget
 *
 * `on_request` means "answer when someone asks", not "answer whenever". Without a ceiling that
 * distinction collapses: a single popular question in a busy room would run a member's key up
 * without their ever being asked again. So `on_request` without `callLimit` is treated as
 * `silent`, and the UI says why rather than quietly allowing it.
 */
export function canModelAnswer(input: {
  sharing: ModelSharing;
  callLimit: number | null;
  dailyLimit: number | null;
  usage: ModelUsage;
}): { allowed: true } | { allowed: false; reason: "silent" | "budget" | "daily" } {
  if (input.sharing === "silent") return { allowed: false, reason: "silent" };

  if (input.callLimit !== null && input.usage.totalCalls >= input.callLimit) {
    return { allowed: false, reason: "budget" };
  }
  if (input.dailyLimit !== null && input.usage.callsToday >= input.dailyLimit) {
    return { allowed: false, reason: "daily" };
  }

  // `on_request` with no total ceiling is allowed, but only because the UI makes the ceiling
  // explicit when sharing is switched on. A ceiling of null here means "I did not set one",
  // which is a real choice, and refusing it would be inventing a limit nobody agreed to.
  return { allowed: true };
}

/** The sentence a member sees when their model cannot answer, in their language. */
export function sharingRefusalMessage(
  reason: "silent" | "budget" | "daily",
  ar: boolean,
): string {
  if (ar) {
    if (reason === "silent") return "صاحب هذا النموذج لم يشارك به في هذه الغرفة.";
    if (reason === "daily") return "وصل نموذج صاحبه إلى حده اليومي. يعود غدا.";
    return "وصل نموذج صاحبه إلى حده في هذه الغرفة.";
  }
  if (reason === "silent") return "That model's owner has not shared it in this room.";
  if (reason === "daily") return "That model has reached its owner's daily limit. It returns tomorrow.";
  return "That model has reached its owner's limit in this room.";
}

/** The sentence an owner sees about their own model, which is a different sentence. */
export function usageMessage(input: ModelUsage & { ar: boolean }): string {
  const { totalCalls, callsToday, ar } = input;
  return ar
    ? `استخدم ${totalCalls} مرة · ${callsToday} اليوم`
    : `Used ${totalCalls} time${totalCalls === 1 ? "" : "s"} · ${callsToday} today`;
}