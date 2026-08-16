# PermaMind cloud read-only MCP

The MCP endpoint is `/api/mcp`. Every request must authenticate as a Supabase user. The endpoint uses the user's authenticated Supabase client and never uses a shared service-role key.

The only tools are `list_allowed_summaries`, `get_allowed_summary`, and `search_allowed_summaries`. They return explicitly selected summary fields only. They do not read local data, full messages, ciphertext, or Arweave snapshots. There are no write, delete, upload, or restore tools.

**Privacy warning:** data returned by MCP may reach Claude, Cursor, OpenAI Codex, or another connected MCP client. Enable sharing only for summaries you explicitly agree to disclose.

## Setup

Run `supabase/mcp-readonly.sql` after the existing cloud-summary schema. The client upload path sets `mcp_allowed` only when the user explicitly selected cloud sharing. Configure the MCP client to use the deployed `/api/mcp` URL with the user's Supabase access token as `Authorization: Bearer <token>`.

Arabic: هذا MCP سحابي للقراءة فقط. قد تصل البيانات التي يعيدها إلى Claude أو Cursor. لا يقرأ البيانات المحلية أو الرسائل الكاملة أو النص المشفر أو نسخ Arweave، ولا يستخدم مفتاح service role مشتركًا.

## Cursor, Claude, and OpenAI Codex

Use the deployed URL as a remote MCP server:

```text
https://your-domain.com/api/mcp
```

The current server expects a Supabase access token in the request header:

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
        "Authorization": "Bearer YOUR_PERMAMIND_ACCESS_TOKEN"
      }
    }
  }
}
```

Codex versions and hosts may expose MCP configuration differently. If the installed Codex client does not support remote Streamable HTTP MCP or custom headers, this cloud connection will not work until that support is available. Do not commit this configuration with a real token. The application does not yet issue a separate revocable MCP token, so a production deployment should add that before broad distribution.

The endpoint is configured as a remote MCP server, not a local command. Do not configure `PERMAMIND_MCP_DATA`, `PERMAMIND_MCP_POLICY`, or any local export file.

There is no local MCP command or local policy file.