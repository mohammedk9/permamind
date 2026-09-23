import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: vi.fn() }));

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getMcpAuth } from "./security";

const TOKEN = `pmcp_${"ab".repeat(32)}`;

describe("MCP token authentication", () => {
  it("rejects a Supabase session token without querying storage", async () => {
    const rpc = vi.fn();
    vi.mocked(getSupabaseAdminClient).mockReturnValue({ rpc } as never);
    const request = new Request("https://app.example/api/mcp", { headers: { authorization: "Bearer eyJsession.jwt.token" } });
    await expect(getMcpAuth(request)).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("resolves only a well-formed MCP token", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "user-1", error: null });
    vi.mocked(getSupabaseAdminClient).mockReturnValue({ rpc } as never);
    const request = new Request("https://app.example/api/mcp", { headers: { authorization: `Bearer ${TOKEN}` } });
    await expect(getMcpAuth(request)).resolves.toEqual({ token: TOKEN, userId: "user-1" });
    expect(rpc).toHaveBeenCalledWith("resolve_mcp_token", { p_token: TOKEN });
  });
});
