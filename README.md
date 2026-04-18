# PTC Cortex

PTC's AI capability hub — a LangGraph-powered intelligent chat platform with multi-turn conversations, personas, tool calling, web search, file parsing, image generation & understanding, and more.

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19
- **AI Engine**: LangChain + LangGraph (ReAct Agent)
- **Model**: DeepSeek (OpenAI-compatible)
- **Database**: PostgreSQL
- **Styling**: Tailwind CSS v4
- **Auth**: Auth.js (shared sessions with ink-and-code)
- **Tool Extension**: MCP (Model Context Protocol)

## Features

- **Multi-turn Chat** — SSE streaming with Markdown rendering and code highlighting
- **Stop / Regenerate / Edit** — Interrupt streaming, regenerate an answer, or edit a past question; alternative versions are preserved and switchable via `< n/total >`
- **One-shot Publish** — Ask "写一篇 XX 并发布", the AI drafts Markdown and calls `prepare_article_publish`; a confirmation modal lets you review & push to Ink & Code
- **Personas** — Built-in + custom personas to tailor AI behavior per scenario
- **Tool Calling** — Calculator, time queries, RAG knowledge retrieval, web search, image generation/understanding, file parsing, and more
- **MCP Servers** — Extensible external tools (Playwright, filesystem, Fetch, etc.)
- **Text Analysis** — Structured analysis powered by Zod schema validation
- **File Upload** — PDF, Excel, and other document parsing
- **Long-term Memory** — PostgreSQL-backed persistent memory across sessions
- **Theming** — Light/dark mode + custom accent colors
- **External API** — `/api/v1/chat` provides a stateless streaming interface with Bearer token auth for other services

## Getting Started

### Environment Variables

Copy `.env.local.example` (or reference the variables below) to create `.env.local`:

```
DATABASE_URL=            # PostgreSQL connection string
DEEPSEEK_API_KEY=        # DeepSeek API key
DEEPSEEK_BASE_URL=       # DeepSeek API base URL
API_SECRET_KEY=          # Bearer token for external API auth
NEXT_PUBLIC_BASE_PATH=   # Deployment sub-path (e.g. /chat), leave empty for local dev
INK_AND_CODE_URL=        # Ink & Code base URL, used by the publish-article tool
INK_AND_CODE_TOKEN=      # Optional. Bearer token fallback; normally unnecessary because
                         # the publish-article route forwards the current user's session
                         # cookie to Ink & Code (shared Auth.js session). Only set this
                         # when cookie forwarding is not viable (e.g. different domain).
```

### Install & Run

```bash
npm install

# Development server (port 3001)
npm run dev

# Production build
npm run build

# Production server
npm start
```

Open [http://localhost:3001](http://localhost:3001) to view the app.

## Project Structure

```
src/
├── app/
│   ├── api/           # API routes (chat, sessions, personas, mcp-servers, upload, analyze, user)
│   ├── layout.tsx     # Root layout (auth guard, theme, fonts)
│   ├── page.tsx       # Main UI (session list, chat, persona/analysis/MCP panels)
│   └── globals.css    # Tailwind v4 + design tokens
├── components/        # UI components
├── lib/               # Core libraries
│   ├── graph.ts       # LangGraph agent definition
│   ├── tools.ts       # Built-in tool set
│   ├── mcp-client.ts  # MCP client
│   ├── db.ts          # Database operations
│   ├── rag.ts         # RAG retrieval
│   ├── search.ts      # Web search
│   ├── vision.ts      # Image understanding
│   ├── image-gen.ts   # Image generation
│   └── long-memory.ts # Long-term memory
└── middleware.ts       # Auth middleware
```

## Deployment

The app supports sub-path deployment via `NEXT_PUBLIC_BASE_PATH` (e.g. `/chat`). Auth relies on shared PostgreSQL sessions with ink-and-code, so both apps must be deployed on the same domain to share cookies.
