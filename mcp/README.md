# PermaMind cloud read-only MCP

The MCP endpoint is `/api/mcp`. Every request must present a separately issued MCP token (`pmcp_` followed by 64 hex characters). Supabase session tokens and browser cookies are rejected. The server resolves the token hash with the service role, then reads only summaries the user marked `mcp_allowed`. It never uses the service role to read ciphertext, messages, or another user's data.

The tools are `list_allowed_summaries`, `get_allowed_summary`, `search_allowed_summaries`, `search_memory`, `get_memory`, and `list_decisions`. They return explicitly selected summary and decision fields only, including the date and source title. They do not read local data, full messages, ciphertext, or Arweave snapshots. `save_memory` is registered so a client can discover the boundary, but every call is rejected and audited. There are no working write, delete, upload, or restore tools.

**Privacy warning:** data returned by MCP may reach Claude, Cursor, OpenAI Codex, or another connected MCP client. Enable sharing only for summaries you explicitly agree to disclose.

## Setup

Run `supabase/mcp-readonly.sql` and then `supabase/mcp-tokens.sql`. The client upload path sets `mcp_allowed` only when the user explicitly selected cloud sharing. In Settings, create an MCP token and configure the client with `Authorization: Bearer <mcp-token>`. Tokens expire after 30 days and can be revoked without signing out. A user can have at most five active tokens.

Arabic: هذا MCP سحابي للقراءة فقط. قد تصل البيانات التي يعيدها إلى Claude أو Cursor. لا يقرأ البيانات المحلية أو الرسائل الكاملة أو النص المشفر أو نسخ Arweave، ولا يستخدم مفتاح service role مشتركًا.

## Cursor, Claude, and OpenAI Codex

Use the deployed URL as a remote MCP server:

```text
https://your-domain.com/api/mcp
```

The server expects the MCP token, not a Supabase access token:

```http
Authorization: Bearer <token>
```

For a Codex installation that accepts an `mcpServers` JSON configuration, use this template and replace the placeholder token locally:

```json
{
  "mcpServers": {
    "permamind": {
      "url": "https://your-domain.com/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

Codex versions and hosts may expose MCP configuration differently. If the installed Codex client does not support remote Streamable HTTP MCP or custom headers, this cloud connection will not work until that support is available. Do not commit this configuration with a real token. Revoke the token in Settings if it is exposed.

The endpoint is configured as a remote MCP server, not a local command. Do not configure `PERMAMIND_MCP_DATA`, `PERMAMIND_MCP_POLICY`, or any local export file.

There is no local MCP command or local policy file.