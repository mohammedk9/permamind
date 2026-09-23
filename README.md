# PermaMind

PermaMind is a privacy-focused AI memory workspace. Conversations stay in the browser, relevant memories are retrieved as context, and long-term backups are compressed and encrypted before they reach Arweave.

> **Status:** usable in local development. Production still requires Supabase SQL, authentication, secrets, rate limits, payment configuration, and a scheduled upload worker.

## Features

- Streaming chat through OpenRouter, a personal API key (BYOK), or a supported direct provider.
- Free mode with an automatic server-side fallback across OpenRouter, Groq, and Google AI Studio. Provider keys and internal routes stay on the server.
- Local conversation storage with rename, delete, and cross-conversation search.
- Automatic summaries, topics, tags, and entities, plus memory-aware context before each reply.
- Local usage analytics and a memory-retrieval debug view.
- Supabase authentication, protected API routes, and cloud summary synchronization.
- AES-256-GCM snapshots compressed with gzip, queued durably, and uploaded to Arweave.
- Snapshot restore by latest backup or a validated transaction ID, with size and content limits.
- Optional Exa web search, Groq voice transcription, storage quotas, and multi-network storage purchases.
- Read-only MCP access to summaries the user explicitly allows, using separate revocable tokens.

## Stack

- Next.js 15 (App Router) and React 19
- TypeScript, Tailwind CSS v4, and shadcn/ui
- Supabase Auth and Postgres
- Vitest and Testing Library
- OpenRouter and OpenAI-compatible provider APIs
- Arweave and optional Exa search

## Local setup

Requirements: Node.js 20 or newer and npm.

```bash
npm install
copy .env.example .env.local   # Windows
# cp .env.example .env.local   # macOS/Linux
npm run dev
```

Open `http://localhost:3000`. There is no `.env.example` in this checkout, so create `.env.local` manually and never commit it.

### Minimum configuration

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000

# At least one free-mode provider. Add more for automatic fallback.
OPENROUTER_API_KEY=
GROQ_API_KEY=
GOOGLE_AI_API_KEY=
```

In production, `NEXT_PUBLIC_APP_URL` must be the real `https://` origin. OpenRouter requests fail closed without it.

### Optional capabilities

```bash
# Server administration and background uploads
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_USER_IDS=
CRON_SECRET=
ARWEAVE_APP_WALLET_JWK=

# Web search and voice input
EXA_API_KEY=
SEARCH_MAX_RESULTS=5
SEARCH_PER_USER_MONTHLY_REQUEST_LIMIT=12
SEARCH_GLOBAL_MONTHLY_REQUEST_LIMIT=1200

# Arweave storage purchases through an administrator wallet
NEXT_PUBLIC_STORAGE_PAYMENT_ADDRESS=

# Stablecoin purchases: Solana, Ethereum, and Base
SOLANA_PAYMENT_ADDRESS=
SOLANA_RPC_URL=
SOLANA_USDC_MINT=
SOLANA_USDT_MINT=
ETH_PAYMENT_ADDRESS=
ETHEREUM_RPC_URL=
ETHEREUM_USDC_CONTRACT=
ETHEREUM_USDT_CONTRACT=
ETHEREUM_CONFIRMATIONS=6
BASE_PAYMENT_ADDRESS=
BASE_RPC_URL=
BASE_USDC_CONTRACT=
BASE_USDT_CONTRACT=
BASE_CONFIRMATIONS=3
```

`GROQ_API_KEY` also enables transcription. Leave unused payment or provider values empty; their features return a configuration error instead of failing the whole app.

## Database setup

Run these files in the Supabase SQL editor, in order:

1. `supabase/storage-purchases.sql` — purchases, immutable client updates, and monthly search quotas.
2. `supabase/ai-usage.sql` — durable daily free-tier chat and summary quotas.
3. `supabase/arweave-upload-queue.sql` — encrypted upload queue. Clients can insert pending ciphertext only.
4. `supabase/mcp-readonly.sql` — allowed-summary projection and MCP audit log.
5. `supabase/mcp-tokens.sql` — hashed, expiring, revocable MCP credentials. Run it after the MCP read-only file.

Use the Supabase service role only on the server. Do not expose it with a `NEXT_PUBLIC_` name.

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
| `/memory` | Memory browser |
| `/backup` | Encrypted snapshot and storage management |
| `/settings` | API mode, provider, and preferences |
| `/admin/storage` | Purchase administration for configured admin IDs |
| `/auth/*` | Sign-in, sign-up, and password recovery |
| `/privacy`, `/terms` | Privacy and terms pages |

The API includes chat, summarization, key validation, sync, search, transcription, snapshots, storage quotes and purchases, MCP, and the cron worker under `src/app/api`.

## BYOK and direct providers

Free mode is the default. BYOK accepts OpenRouter plus direct OpenAI-compatible providers, including OpenAI, DeepSeek, Qwen, Kimi, Grok, NanoGPT, Eden AI, OrcaRouter, UnoRouter, LLM7, and Hugging Face. A custom HTTPS base URL is also supported.

The API key is kept only in `sessionStorage` under `permamind:api-key:v1` and disappears when the browser session ends. Provider, model, and base URL preferences remain in `localStorage` because they are not secrets.

## Project structure

```text
src/
  app/          Routes, pages, and API handlers
  components/   Chat, backup, memory, and shadcn/ui components
  hooks/        Client state and browser integration
  lib/          AI, Arweave, memory, payments, search, storage, and Supabase
  types/        Shared TypeScript types
supabase/       SQL for quotas, purchases, upload queue, and MCP
scripts/        Favicon generation
```

## Verification

```bash
npm run dev
npm run lint
npx tsc --noEmit
npm test
npm run build
npm start
```

`npm test` runs the Vitest suite once. Coverage includes encryption, compression, snapshot creation, upload limits, queues, restore validation, quotas, memory retrieval, and UI behavior.

## Security

- Never commit `.env.local`, API keys, service-role keys, wallet JWKs, or database credentials.
- Rotate any secret that appears in a terminal, screenshot, chat, or Git history.
- Snapshot plaintext is compressed and encrypted in the browser. Arweave receives ciphertext, and the passphrase is not uploaded.
- Restore checks metadata, hashes, dates, and payload limits, then requires explicit confirmation before replacing local data.
- Queue status changes and purchase confirmation are reserved for trusted server code.
- MCP tokens are stored as hashes, expire, can be revoked, and can only read summaries marked as allowed.
- Put the deployment behind HTTPS and configure rate limits and monitoring before sharing server-side AI keys.

## Roadmap

- Stronger multi-device synchronization.
- Clearer backup discovery and recovery.
- Expanded provider and model policy controls.
- Deployment monitoring, audit visibility, and operational runbooks.

## License

No public license is declared. All rights are reserved by the project owner until one is added.
