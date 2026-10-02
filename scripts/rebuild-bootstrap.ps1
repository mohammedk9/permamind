# Rebuilds supabase/bootstrap-production.sql from its sources.
#
# The bootstrap is called "generated, do not hand-edit" in its own header, and
# bootstrap-sync.test.ts asserts that it embeds each source verbatim and in order.
# Editing it by hand is what previously duplicated a section, so this script is the
# only supported way to change it.
#
#   powershell -File scripts/rebuild-bootstrap.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$SOURCES = @(
  @{ File = 'ai-usage.sql';            Title = 'AI DAILY ALLOWANCE (ten chat + ten summary requests per UTC day)' },
  @{ File = 'storage-purchases.sql';    Title = 'STORAGE PURCHASES + WEB-SEARCH QUOTA + OPTIONAL CLOUD SYNC' },
  @{ File = 'arweave-upload-queue.sql'; Title = 'ARWEAVE UPLOAD QUEUE' },
  @{ File = 'mcp-readonly.sql';         Title = 'MCP READ-ONLY PROJECTION' },
  @{ File = 'mcp-tokens.sql';           Title = 'MCP TOKENS' },
  @{ File = 'rooms.sql';                Title = 'GROUP ROOMS (ciphertext only, member-token access)' }
)

# The separator has to be a SQL comment. A bare run of `=` is not valid SQL, and the
# bootstrap then fails to run with `42601: operator too long at or near "=="`. The first
# version of this script wrote the rule without its `--`, which shipped past
# bootstrap-sync.test.ts: that test asserts the sources are embedded verbatim, which was
# true, and says nothing about whether the file runs. rooms-sql.test.ts now also asserts
# that no such line survives.
$rule = '-- ' + ('=' * 74)

function Read-Source($path) {
  $text = [System.IO.File]::ReadAllText($path)
  # Strip a UTF-8 BOM: ReadAllText keeps it and the verbatim comparison would fail.
  return $text.TrimStart([char]0xFEFF).TrimEnd()
}

$out = New-Object System.Collections.ArrayList

function Add-Line($text) { [void]$out.Add($text) }

Add-Line '-- ============================================================================'
Add-Line '-- PermaMind - production bootstrap (ADDITIVE ONLY, safe to re-run)'
Add-Line '-- ============================================================================'
Add-Line '-- Run in Supabase Dashboard -> SQL Editor -> New query -> Run.'
Add-Line '--'
Add-Line '-- SAFETY CONTRACT'
Add-Line '--   * This script NEVER runs: drop table / truncate / delete / drop schema.'
Add-Line '--   * Every object uses `create table if not exists` / `create or replace'
Add-Line '--     function`, so it is safe to run more than once.'
Add-Line '--   * The only removals are `drop policy if exists`, which redefines access'
Add-Line '--     rules; a policy is an access rule, not user data.'
Add-Line '--'
Add-Line '-- WHY THIS FILE EXISTS'
Add-Line '-- The tables backing the ten-message daily allowance were committed to the'
Add-Line '-- repo but never applied to the database, so the RPC `reserve_ai_request`'
Add-Line '-- did not exist and every free chat request failed with HTTP 503 instead of'
Add-Line '-- being counted. This script applies them.'
Add-Line '--'
Add-Line '-- GENERATED FILE - do not hand-edit'
Add-Line '-- Produced by scripts/rebuild-bootstrap.ps1. Edit the sources listed below,'
Add-Line '-- never this one: supabase/__tests__/bootstrap-sync.test.ts asserts that each'
Add-Line '-- source is embedded here verbatim and in this order.'
Add-Line '--'
Add-Line ('-- Order matters: extensions -> ' + (($SOURCES | ForEach-Object { ($_.File -split '\.')[0] }) -join ' -> ') + ' -> verification.')
Add-Line $rule
Add-Line ''
Add-Line 'create extension if not exists pgcrypto;'
Add-Line ''

$index = 0
foreach ($source in $SOURCES) {
  $index += 1
  Add-Line $rule
  Add-Line ("-- $index. " + $source.Title)
  Add-Line $rule
  Add-Line ''
  Add-Line (Read-Source (Join-Path 'supabase' $source.File))
  Add-Line ''
}

Add-Line $rule
Add-Line '-- VERIFICATION - these are the last statements. Read the output.'
Add-Line $rule
Add-Line ''
Add-Line 'select c.relname as table_name'
Add-Line 'from pg_class c'
Add-Line 'join pg_namespace n on n.oid = c.relnamespace'
Add-Line 'where n.nspname = ''public'' and c.relkind = ''r'''
Add-Line 'order by c.relname;'
Add-Line ''
Add-Line '-- Row counts confirm legacy data was preserved, not recreated.'
Add-Line 'select ''profiles'' as table_name, count(*) as row_count from public.profiles'
Add-Line 'union all select ''search_usage_monthly'', count(*) from public.search_usage_monthly'
Add-Line 'union all select ''storage_purchases'', count(*) from public.storage_purchases'
Add-Line 'union all select ''ai_usage_daily'', count(*) from public.ai_usage_daily'
Add-Line 'order by table_name;'
Add-Line ''
Add-Line '-- Expect every RPC below to resolve.'
Add-Line 'select p.proname as function_name,'
Add-Line '       pg_get_function_identity_arguments(p.oid) as arguments'
Add-Line 'from pg_proc p'
Add-Line 'join pg_namespace n on n.oid = p.pronamespace'
Add-Line 'where n.nspname = ''public'''
Add-Line '  and p.proname in ('
Add-Line '    ''reserve_ai_request'', ''finalize_ai_request'', ''release_ai_request'','
Add-Line '    ''issue_mcp_token'', ''resolve_mcp_token'', ''read_mcp_summaries'','
Add-Line '    ''reserve_search_request'','
Add-Line '    ''room_role'', ''room_is_open'''
Add-Line '  )'
Add-Line 'order by p.proname;'
Add-Line ''

[System.IO.File]::WriteAllLines('supabase/bootstrap-production.sql', $out)
Write-Host "rebuilt supabase/bootstrap-production.sql from $($SOURCES.Count) sources"
