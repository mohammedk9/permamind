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
- Local conversation state (no backend yet)

## Roadmap

See [docs/TASKS.md](docs/TASKS.md) for the full MVP roadmap.
