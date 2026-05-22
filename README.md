# PermaMind

AI memory platform — chat with AI, save conversations, search memories, and restore context.

## Stack

- **Next.js 15** (App Router, TypeScript)
- **Tailwind CSS v4**
- **shadcn/ui**
- Supabase, OpenRouter, Arweave — planned in later phases

## Getting started

```bash
npm install
cp .env.example .env.local
```

**Free mode (default):** Add a server key to `.env.local` so all users can use free OpenRouter models:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

**BYOK (optional):** Users can add their own OpenRouter key in **Settings** — stored only in the browser, sent per request through `/api/chat` (never saved on the server).

Then run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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

## Phase 1 (current)

- Next.js 15 + TypeScript + Tailwind + shadcn/ui
- ChatGPT-style layout with sidebar and responsive mobile menu
- **OpenRouter** streaming chat (Claude, GPT-4o, Gemini, DeepSeek)
- Model selector, loading states, and error handling
- **localStorage** conversation persistence (auto-save, rename, delete)
- **AI summaries** — auto-generated topics, tags, entities (Gemini Flash, debounced)
- **Memory-aware context** — retrieves relevant past chats and injects them before each reply
- **Usage analytics** — local token/cost tracking, per-model stats, memory retrieval debug panel
- Supabase cloud sync planned in a later phase

## Roadmap

See [docs/TASKS.md](docs/TASKS.md) for the full MVP roadmap.
