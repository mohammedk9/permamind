import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, { cookies: { getAll: () => request.cookies.getAll(), setAll: values => values.forEach(({ name, value, options }) => { request.cookies.set(name, value); response.cookies.set(name, value, options); }) } });
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return response;

  // A failed getUser() is not proof of a signed-out user. The access token is
  // short lived, so a returning visitor with a stored session can fail
  // validation while their refresh token is still valid. Redirecting on that
  // alone is what forced a re-login on every visit, so refresh once and only
  // send the user to the sign-in screen when no session is left.
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed?.user) return response;
  }

  return NextResponse.redirect(new URL("/auth/sign-in", request.url));
}

// `/r/*` is deliberately absent. A room guest has no Supabase account by design:
// they join with a link and a six-digit code, and the room's own member token
// authorises them afterwards. Including it here would redirect every guest to the
// sign-in screen, which would make the feature impossible to use.
//
// `/rooms/new` is present, because opening a room is a host action and the host is
// signed in: the room row carries `owner_id`, which is a foreign key to auth.users.
export const config = { matcher: ["/chat/:path*", "/memory/:path*", "/backup/:path*", "/settings/:path*", "/rooms/:path*"] };
