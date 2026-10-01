import {
  availableProviders,
  isProviderConfigured,
  parseSearchProvider,
  runWebSearch,
} from "@/lib/search/provider";
import { currentSearchMonth, SEARCH_GLOBAL_LIMIT, SEARCH_PER_USER_LIMIT } from "@/lib/search/quota";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Which providers have a server-side key right now. Only provider *ids* are
 * returned — never keys, never which env var supplied them.
 */
export async function POST() {
  const { user } = await requireUser();
  if (!user) return Response.json({ error: "Sign in to use web search" }, { status: 401 });
  return Response.json({ providers: availableProviders() });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  if (!query || query.length > 500) return Response.json({ error: "A valid search query is required" }, { status: 400 });

  const provider = parseSearchProvider(params.get("provider"));
  if (!isProviderConfigured(provider)) return Response.json({ error: "Web search is not configured" }, { status: 503 });

  const { supabase, user } = await requireUser();
  if (!supabase || !user) return Response.json({ error: "Sign in to use web search" }, { status: 401 });

  const { data, error } = await supabase.rpc("reserve_search_request", {
    p_user_id: user.id,
    p_month_key: currentSearchMonth(),
    p_user_limit: SEARCH_PER_USER_LIMIT,
    p_global_limit: SEARCH_GLOBAL_LIMIT,
  });
  if (error) return Response.json({ error: "Search quota is unavailable" }, { status: 503 });
  const quota = Array.isArray(data) ? data[0] : data;
  if (!quota?.allowed) {
    return Response.json({ error: "Monthly web-search limit reached", used: quota?.user_count ?? SEARCH_PER_USER_LIMIT, limit: SEARCH_PER_USER_LIMIT }, { status: 429 });
  }

  const { results, provider: resolved } = await runWebSearch(query, provider);
  return Response.json({ results, provider: resolved, used: quota.user_count, limit: SEARCH_PER_USER_LIMIT });
}