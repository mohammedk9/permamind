/**
 * The "when does the allowance come back" label, shared by the error banner and
 * the free-quota card.
 *
 * It lives here rather than inside either component because both must agree: a
 * user who sees "Resets at 12:00 AM UTC" in one place and a local time in
 * another has been told two different things.
 *
 * The time is deliberately rendered in UTC. The server's daily counter is keyed
 * on `(now() at time zone 'utc')::date`, so the reset really is UTC midnight;
 * showing the user's local clock would invite them to wait an hour too long, or
 * to retry an hour too early and be refused again.
 */

import { translations, type Locale } from "@/lib/i18n/translations";

/** "Resets at 12:00 AM UTC" / "تتجدّد عند ١٢:٠٠ ص UTC". */
export function formatQuotaResetLabel(
  resetAt: string | null | undefined,
  locale: Locale,
): string | null {
  if (!resetAt) return null;
  const time = Date.parse(resetAt);
  if (Number.isNaN(time)) return null;

  const clock = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(time);

  return `${translations[locale].freeQuotaResetAt} ${clock} UTC`;
}