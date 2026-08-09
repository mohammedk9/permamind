# PermaMind

PermaMind is a privacy-focused AI memory workspace. It combines streaming AI chat, local conversation storage, semantic memory retrieval, analytics, web search, and encrypted long-term backups on Arweave.

> **Project status:** active development. The application is usable locally, but production deployment still requires careful configuration of authentication, payment, rate limits, and secret management.

## Stack

- **Next.js 15** (App Router, TypeScript)
- **Tailwind CSS v4**
- **shadcn/ui**
- Supabase authentication and server-side data access
- OpenRouter and optional direct AI providers
- Exa web search and Arweave encrypted backups

## What it does

- Chat with OpenRouter or supported direct AI providers.
- Use a personal API key (BYOK) or a server-side OpenRouter key for configured free models.
- Persist conversations locally in the browser and search across past memories.
- Generate summaries, topics, tags, and entities, then retrieve relevant memories as context.
- Create encrypted, compressed snapshots and upload them to Arweave.
- Restore the latest snapshot or manually recover with a validated Arweave transaction ID.
- Authenticate users with Supabase and manage storage purchases and quotas.

## Getting started

```bash
npm install
copy .env.example .env.local
```

If `.env.example` is not present, create `.env.local` manually. Never commit it.

**Free mode (default):** Add a server key to `.env.local` so all users can use free OpenRouter models:

```
OPENROUTER_API_KEY=sk-or-v1-...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**BYOK (optional):** Users can add their own OpenRouter key in **Settings** — stored only in the browser, sent per request through `/api/chat` (never saved on the server).

Then run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Optional environment variables

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXA_API_KEY=your-exa-key
NEXT_PUBLIC_ARWEAVE_NETWORK=mainnet
ARWEAVE_APP_WALLET_JWK='{"kty":"RSA",...}'
DATABASE_URL=your-database-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_USER_IDS=comma-separated-user-ids
NEXT_PUBLIC_STORAGE_PAYMENT_ADDRESS=your-address
SOLANA_PAYMENT_ADDRESS=your-address
ETH_PAYMENT_ADDRESS=0x...
```

`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, and `ARWEAVE_APP_WALLET_JWK` are server secrets. Do not expose them through `NEXT_PUBLIC_*` variables.

## Useful commands

```bash
npm run dev                 # Development server
npm run build               # Production build
npm start                   # Run production build
npm run lint                # ESLint
npm test                    # Vitest
npx tsc --noEmit            # Type-check
```

## Project structure

```
src/
  app/              # Next.js routes & layout
  components/
    chat/           # Chat UI (sidebar, messages, input)
    ui/             # shadcn components
  lib/              # Shared utilities & constants
  types/            # TypeScript types
docs/
  PROJECT_VISION.md
  TASKS.md
```

## Current capabilities

- Next.js 15 + TypeScript + Tailwind + shadcn/ui
- ChatGPT-style layout with sidebar and responsive mobile menu
- **OpenRouter** streaming chat (Claude, GPT-4o, Gemini, DeepSeek)
- Model selector, loading states, and error handling
- **localStorage** conversation persistence (auto-save, rename, delete)
- **AI summaries** — auto-generated topics, tags, entities (Gemini Flash, debounced)
- **Memory-aware context** — retrieves relevant past chats and injects them before each reply
- **Usage analytics** — local token/cost tracking, per-model stats, memory retrieval debug panel
- Supabase authentication and protected server routes
- Encrypted/compressed Arweave snapshot pipeline with queueing and restore hardening
- Optional Exa search and storage quota/payment flows

## Roadmap

- Improve cloud synchronization and multi-device memory management.
- Expand provider support and configurable model policies.
- Add stronger operational controls: rate limiting, audit logs, monitoring, and deployment documentation.
- Improve backup discovery and recovery UX.

## Security and privacy

- Never commit `.env.local`, API keys, service-role keys, database passwords, or wallet JWKs.
- Rotate any secret exposed in a terminal, chat, screenshot, or repository history immediately.
- Snapshot payloads are encrypted in the client before upload; the passphrase is not sent to Arweave.
- Restore validates metadata, hashes, dates, payload limits, and explicit user confirmation before replacing local data.
- Use HTTPS in production and set `NEXT_PUBLIC_APP_URL` to the real HTTPS origin.
- Configure rate limits and monitoring before sharing a server-side AI key with multiple users.

## Testing

The repository includes unit and integration coverage for encryption, compression, snapshots, upload protection, queues, restore hardening, quotas, memory retrieval, and UI behavior.

Run the complete checks with:

```bash
npm run lint && npx tsc --noEmit && npm test -- --run
```

## License

No public license has been declared yet. Unless a license is added to this repository, all rights are reserved by the project owner.
