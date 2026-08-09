import { searchInternet } from "@/lib/search/exa";
import { currentSearchMonth, SEARCH_GLOBAL_LIMIT, SEARCH_PER_USER_LIMIT } from "@/lib/search/quota";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query || query.length > 500) return Response.json({ error: "A valid search query is required" }, { status: 400 });
  if (!process.env.EXA_API_KEY) return Response.json({ error: "Web search is not configured" }, { status: 503 });

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

  const results = await searchInternet(query);
  return Response.json({ results, used: quota.user_count, limit: SEARCH_PER_USER_LIMIT });
}