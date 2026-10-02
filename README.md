# PermaMind

PermaMind is a privacy-focused AI memory workspace. Conversations stay in the browser, relevant memories are retrieved as context, and long-term backups are compressed and encrypted before they reach Arweave.

> **Status:** usable in local development. Production still requires Supabase SQL, authentication, secrets, rate limits, payment configuration, and a scheduled upload worker.

## Features

- Streaming chat through OpenRouter, a personal API key (BYOK), or a supported direct provider.
- Free mode with an automatic server-side fallback across OpenRouter, Groq, and Google AI Studio. Provider keys and internal routes stay on the server. The shared key is limited to 10 chat messages and 10 summaries per UTC day per user, tracked durably in Postgres so a browser reload cannot reset the count. A request is reserved first and only counted on completion, so a failed provider call or a cancelled stream does not spend the allowance.
- Local conversation storage with rename, delete, and cross-conversation search.
- Full account export and import in one file — conversations, projects, the memory ledger, storage preferences, and policy. A readable JSON file for self-hosting and inspection, or a gzip + AES-256-GCM archive for moving to another device. The API key is never included. Import shows a plan first and merges rather than replaces, so a stale file cannot wipe newer local work.
- Local storage health monitoring. The browser reports exhaustion only by throwing `QuotaExceededError`, which previously discarded a write with no signal anywhere: the user kept chatting, saw a successful reply, and lost the conversation on the next refresh. A banner now reports real per-origin usage, breaks it down per store, and surfaces the failed write itself.
- Delta cloud sync. The client keeps a watermark and pulls only rows newer than it, merging by `updatedAt` instead of re-sending the whole dataset every time.
- Automatic summaries, topics, tags, and entities, plus memory-aware context before each reply.
- Hybrid memory retrieval: local BM25 ranked by inverse document frequency, fused with embedding similarity through reciprocal rank fusion, and capped by an embedding pre-filter. Everything runs on the device; the index is built in memory and discarded.
- Shared Arabic normalization for every retrieval path — diacritics, tatweel, zero-width marks, and hamza variants are folded once in `lib/i18n/arabic-normalize`, so the lexical and the semantic ranker no longer normalize the same sentence into two different strings.
- A decision ledger inside the Memory page. Active decisions come first, and a superseded decision stays visible underneath with its source and date. You can open the source conversation, pin a decision, correct it, or save a short note as a new decision beside the old one. A later extraction marks an old decision superseded only when the extraction says so. Pinned and manually corrected records are not overwritten.
- Decision questions in English or Arabic, such as "what did we decide?" or "ماذا قررنا؟", retrieve more decision context and ask the model to cite the source title, date, and whether a decision was superseded. If the source is insufficient, the answer says so instead of inventing one.
- Optional local Ollama in Settings, fixed to `http://127.0.0.1:11434/v1`, with no API key. Other HTTP addresses stay blocked. Web search is disabled in this mode, and cloud sync should stay off so decision context does not leave the device.
- Local usage analytics and a memory-retrieval debug view.
- Supabase authentication, protected API routes, and cloud summary synchronization.
- AES-256-GCM snapshots compressed with gzip, queued durably, and uploaded to Arweave.
- Snapshot restore by latest backup or a validated transaction ID, with size and content limits.
- Optional web search with three independent providers — Exa (default), AnySearch, and Gemini Grounding — plus Groq voice transcription, storage quotas, and multi-network storage purchases.
- Read-only MCP access to summaries and decisions the user explicitly allows, including `search_memory`, `get_memory`, and `list_decisions`. `save_memory` is visible but every call is rejected and audited. See `mcp/README.md`.
- A bilingual interface, English and Arabic, with the landing page and the app sharing one translation bundle.

## Encrypted rooms

A third conversation type: a short-lived encrypted room where several people and one AI model hold the same conversation. The design record, including the options that were considered and discarded, is `docs/group-rooms-design.md`.

- **Guests need no account.** A link plus a six-digit code. The code is exchanged for a random member token, and the room key is unwrapped on the guest's own device.
- **The server stores ciphertext it cannot read.** Messages are sealed with AES-256-GCM under a room key that never leaves the host's device. A leaked database is not a readable transcript.
- **The model reads the room and nothing else.** The request is assembled in `lib/rooms/ai-bridge.ts`, which imports nothing from the memory ledger, the private chat, or local storage. A test asserts the built request carries no text from outside the room, using private text that deliberately overlaps the room's own subject. Do not add an import to that file without changing the design first.
- **The host decides who spends their key.** A `guest` may read and write but cannot invoke the model; the host promotes members to `trusted`. Only the host and trusted members can ask it anything.
- **Realtime carries a signal, not content.** No room table is in the `supabase_realtime` publication. The server announces "something changed" on a channel named after a 128-bit `feed_id`, and the subscriber re-reads through the member-token API. A subscriber who guesses the channel learns that a room exists and nothing else.
- **Two key modes.** Option A: the host's browser signs each request with a key that never reaches our servers, and the model stops when they leave. Option B: the key is sealed with envelope encryption — a per-host data key, itself sealed under `ROOM_KEY_MASTER_SECRET` from the environment — so a database dump on its own cannot open it. B requires `ROOM_KEY_MASTER_SECRET`; without it, storage refuses rather than falling back to plaintext.
- **Every stored key has an end date.** There is no "forever" at the schema, the API boundary, or the store. An expired row is deleted on the next read.
- **A room is not an archive.** The host sets an expiry, and closing a room deletes it and its transcript. The quota is two active rooms per host.
- **A room never touches the free tier.** `isValidModelId` accepts a `:free` id, so room creation separately requires a BYOK-tier model; otherwise the room would be billed to PermaMind instead of to the host.

Apply the schema with `supabase/bootstrap-production.sql`, which is generated from the files in `supabase/` — edit the source, then run `powershell -File scripts/rebuild-bootstrap.ps1`.

## Stack

- Next.js 15 (App Router) and React 19
- TypeScript, Tailwind CSS v4, and shadcn/ui
- Supabase Auth and Postgres
- Vitest and Testing Library
- OpenRouter and OpenAI-compatible provider APIs
- Arweave and optional Exa, AnySearch, or Gemini Grounding search

## Local setup

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. There is no `.env.example` in this checkout, so create `.env.local` yourself and never commit it. See [Configuration](#configuration).

### Configuration

Minimum configuration:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000

# At least one free-mode provider. Add more for automatic fallback.
OPENROUTER_API_KEY=
GROQ_API_KEY=
GOOGLE_AI_API_KEY=

# Web search. Exa is the default; add the others to enable them.
EXA_API_KEY=
ANYSEARCH_API_KEY=
GEMINI_API_KEY=
# Optional. Defaults to gemini-2.5-flash when unset.
# GEMINI_GROUNDING_MODEL=gemini-2.5-flash
```

In production, `NEXT_PUBLIC_APP_URL` must be the real `https://` origin. OpenRouter requests fail closed without it.

`GROQ_API_KEY` also enables transcription. Leave unused payment or provider values empty; their features return a configuration error instead of failing the whole app.

## Web search providers

Web search is optional and runs behind the same monthly per-user quota for every provider. The provider is chosen in the chat composer next to the web-search toggle, and the choice is stored locally in `localStorage` under `permamind:search-provider:v1`. Provider keys never reach the browser; only the preference does.

| Provider | Key | Notes |
| --- | --- | --- |
| Exa | `EXA_API_KEY` | The default. Existing installs behave exactly as before. |
| AnySearch | `ANYSEARCH_API_KEY` | Independent of the LLM provider and of Exa. Works with any model. |
| Gemini Grounding | `GEMINI_API_KEY`, `GOOGLE_AI_API_KEY`, or `GOOGLE_API_KEY` | Calls Gemini directly with `tools: [{ google_search: {} }]`, never through OpenRouter. Model overridable with `GEMINI_GROUNDING_MODEL`. |

If the selected provider is not configured, or returns nothing, PermaMind falls back to Exa when Exa is configured, so a temporarily unavailable free key never turns into a failed reply. Every hit is normalized to one `SearchCitation` shape (`title`, `url`, `text`, `source`, `retrievedAt`) before it reaches the model, which keeps the prompt format identical no matter which provider answered.

AnySearch's free tier is limited to a trial period rather than a permanent free plan, so treat it as an optional second provider and keep `EXA_API_KEY` set if you want a stable default. Google Grounding requires a Gemini key and is not part of the free chat tier.

`GET /api/search` accepts an optional `provider` query parameter and returns the provider that actually answered. `POST /api/search` returns the provider ids that currently have a server-side key, so the UI can show only what is usable. Provider keys are read from the environment on the server and are never sent to the browser.

## Database setup

Run these files in the Supabase SQL editor, in order:

1. `supabase/ai-usage.sql` — durable daily free-tier chat and summary quotas.
2. `supabase/storage-purchases.sql` — purchases, immutable client updates, and monthly search quotas.
3. `supabase/arweave-upload-queue.sql` — encrypted upload queue. Clients can insert pending ciphertext only.
4. `supabase/mcp-readonly.sql` — allowed-summary projection and MCP audit log.
5. `supabase/mcp-tokens.sql` — hashed, expiring, revocable MCP credentials. Run it after the MCP read-only file.
6. `supabase/rooms.sql` — the encrypted room tables: `rooms`, `room_members`, `room_messages`, `room_ideas`, `room_votes`, and `host_ai_keys`.

`supabase/bootstrap-production.sql` is a generated concatenation of exactly those six, in that order, plus `pgcrypto` and verification queries. Prefer it for a fresh database. It is additive and safe to re-run: it never drops a table, truncates, or deletes, and it carries its own provenance note explaining why it exists. It is generated — edit the six source files, never the bootstrap.

Use the Supabase service role only on the server. Do not expose it with a `NEXT_PUBLIC_` name.

### Rooms: `ROOM_KEY_MASTER_SECRET`

Only needed for Option B, the setting that keeps a host's provider key on our servers so a room can answer without them:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Without it the key store refuses rather than falling back to writing anything in the clear, and the "On our server" option reports that it is unavailable. Option A needs no extra variable and works without it.

**Rotating it makes every stored key unreadable.** There is no re-wrapping path, and the room falls back to Option A. That is the intended behaviour for a compromised secret, but it means a rotation is a user-visible action rather than a transparent one.

## Production operations

Schedule an authenticated call to the upload worker:

```bash
curl -X POST https://your-domain.example/api/cron/arweave-queue \
  -H "Authorization: Bearer $CRON_SECRET"
```

The worker needs `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and `ARWEAVE_APP_WALLET_JWK`. It uploads ciphertext independently of the user's browser and retries with backoff.

Managed storage defaults are 15 MB of free quota, a 50 MB maximum upload, 10 uploads per hour on the free tier, and 100 per hour on the paid tier. Snapshot passphrases must be at least 8 characters; encryption enforces this even if a caller bypasses the UI.

## Application routes

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/chat` | Streaming chat workspace |
| `/memory` | Memory browser and decision ledger |
| `/backup` | Encrypted snapshot and storage management |
| `/settings` | API mode, provider, and preferences |
| `/storage` | How local, cloud, and Arweave storage relate |
| `/admin/storage` | Purchase administration for configured admin IDs |
| `/auth/*` | Sign-in, sign-up, and password recovery |
| `/privacy`, `/terms` | Privacy and terms pages |

The API includes chat, summarization, key validation, sync, search, transcription, snapshots, storage quotes and purchases, MCP, and the cron worker under `src/app/api`.

## BYOK and direct providers

Free mode is the default. BYOK accepts OpenRouter plus direct OpenAI-compatible providers, including OpenAI, DeepSeek, Qwen, Kimi, Grok, NanoGPT, Eden AI, OrcaRouter, UnoRouter, LLM7, and Hugging Face. A custom public HTTPS base URL is also supported.

Local mode is optional and separate from BYOK. Choose **Ollama on this device** in Settings and enter the Ollama model name. PermaMind uses only `http://127.0.0.1:11434/v1`, sends no API key, and does not install Ollama for you. Any other non-HTTPS address is rejected. While this provider is selected, web search stays off. Keep cloud sync off as well if the decision context must remain on the device. Cloud and BYOK providers remain available when you switch back.

The API key is kept only in `sessionStorage` under `permamind:api-key:v1` and disappears when the browser session ends. Provider, model, and base URL preferences remain in `localStorage` because they are not secrets. The local provider stores no API key.

## Project structure

```text
src/
  app/          Routes, pages, and API handlers
  components/   Chat, backup, memory, settings, and shadcn/ui components
  hooks/        Client state and browser integration
  lib/          AI, Arweave, memory, payments, search, storage, and Supabase
  types/        Shared TypeScript types
supabase/       SQL for quotas, purchases, upload queue, and MCP
scripts/        Favicon generation
mcp/            MCP server documentation
```

Notable modules:

| Module | Why it exists |
| --- | --- |
| `lib/search/bm25.ts` | Lexical ranking by inverse document frequency. The previous scorer awarded one point per matching token, so a term in fifty conversations scored the same as a term in one, and ranking became arbitrary after a few dozen conversations. |
| `lib/search/reciprocal-rank-fusion.ts` | Merges the lexical and semantic rankings without needing comparable scores. |
| `lib/i18n/arabic-normalize.ts` | One normalization for all four retrieval paths, which had drifted into producing different strings for the same Arabic sentence. |
| `lib/storage/download.ts` | The single download path. Revoking the object URL in the same task as `click()` tears the blob down before the browser reads it, which makes an export button intermittently produce no file. |
| `lib/storage/full-export.ts` | Builds the portable archive and validates an import before a single byte is written. |
| `lib/storage/storage-health.ts` | Measures real per-origin usage and broadcasts write failures, because the browser only signals exhaustion by throwing. |

## Export, import, and downloads

Every export in the app goes through `lib/storage/download`, and this is deliberate. The obvious three-liner is silently unreliable:

```ts
const url = URL.createObjectURL(blob);
link.click();
URL.revokeObjectURL(url);   // tears the blob down before the browser reads it
```

Chrome usually wins that race; other engines deliver no file at all. The symptom is an export button that appears to work and then silently produces nothing, which is far harder to diagnose than a hard failure. The shared helper attaches the anchor, clicks, and revokes on a later task.

The Settings → Backup panel offers two shapes from the same data:

| Format | Use it for | Notes |
| --- | --- | --- |
| Readable JSON | Inspection, self-hosting, keeping your own copy | Human-readable. The API key is never included. |
| `.pmx` encrypted archive | Moving an account to another device | gzip then AES-256-GCM, the same pipeline as the Arweave backup. Compression happens before encryption because ciphertext has high entropy and would not compress. |

Import validates the whole archive before writing anything, then merges rather than replaces: a newer copy of each item wins, and a record you edited by hand (`source: "user"`) is never overwritten by an extracted copy. The one destructive path in the app stays the explicit restore confirmation on `/backup`, which is a separate flow with its own review.

## Verification

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

`npm test` runs the Vitest suite once. Coverage includes encryption, compression, snapshot creation, upload limits, queues, restore validation, quotas, memory retrieval, download behavior, and UI behavior.

## Security

- Never commit `.env.local`, API keys, service-role keys, wallet JWKs, or database credentials.
- Rotate any secret that appears in a terminal, screenshot, chat, or Git history.
- Snapshot plaintext is compressed and encrypted in the browser. Arweave receives ciphertext, and the passphrase is not uploaded.
- An exported archive never contains the API key. It lives in `sessionStorage` and is not part of any localStorage payload, so it cannot travel inside a backup.
- Restore and import both check metadata, hashes, dates, and payload limits, then require explicit confirmation before replacing local data.
- Queue status changes and purchase confirmation are reserved for trusted server code.
- MCP tokens are stored as hashes, expire, can be revoked, and can only read summaries and decisions marked as allowed. Writes through MCP are rejected. Full messages, ciphertext, Arweave snapshots, and other users' data are never returned.
- Put the deployment behind HTTPS and configure rate limits and monitoring before sharing server-side AI keys.

## Known limitations

- `localStorage` is small (5 MB in Chromium, 10 MB in Firefox) and every conversation, the memory ledger, and the embedding index live there. Storage health warns before a write fails; migrating to IndexedDB is not done yet.
- An Arweave upload is permanent. Losing the passphrase means that copy cannot be decrypted by anyone, including you.
- Search providers are configured server-side, so the chat composer can only offer providers that currently have a key. AnySearch's free tier is time-limited rather than permanent.
- The app renders in English on the server and corrects the language on the client, because the chosen locale lives in `localStorage`.

## Roadmap

- Stronger multi-device synchronization.
- Clearer backup discovery and recovery.
- Expanded provider and model policy controls.
- Migrating local storage to IndexedDB to escape the localStorage quota.
- Deployment monitoring, audit visibility, and operational runbooks.

## License

No public license is declared. All rights are reserved by the project owner until one is added.
