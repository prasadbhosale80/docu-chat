# Driving Licence Workspace

Upload a driving licence photo, review the extracted fields, then ask questions about that document. Extraction and chat run against Google Gemini through LangChain. Nothing is persisted beyond the current browser tab and the Node.js process.

## Technology stack

| Layer          | Choice                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| App            | [Next.js](https://nextjs.org) 16 (App Router) + React 19 + TypeScript                                       |
| UI             | [Tailwind CSS](https://tailwindcss.com) 4, [shadcn/ui](https://ui.shadcn.com) (Base Nova / Base UI), Lucide |
| Forms          | React Hook Form + Zod (`@hookform/resolvers`)                                                               |
| Chat rendering | `react-markdown` + `remark-gfm`                                                                             |
| LLM            | Google Gemini via `@langchain/google-genai`                                                                 |
| Agents         | LangChain `createAgent` + LangGraph `MemorySaver`                                                           |
| Validation     | Zod schemas shared by the form, extract API, and chat API                                                   |

Runtime AI calls stay on the server (`server-only` in `lib/gemini.ts` and `lib/extract-licence.ts`). Route handlers use the Node.js runtime with a 60s `maxDuration`.

## Architecture

The product is a single-page workspace. Client session state lives in React context. The server never stores the image or the form; it only sees the file during extract, and the saved fields plus OCR text during chat.

```text
Browser
  DocumentSessionProvider  (file, preview, fields, ocrText, saved, thread id)
       │
       ├─ POST /api/extract  (multipart image)
       │     └─ Gemini vision + structured output (Zod licence schema)
       │
       └─ POST /api/chat     (JSON: threadId, last user turn, fields, ocrText)
             └─ LangChain agent + MemorySaver, streamed plain text
```

### Request flow

1. Drop or pick a PNG / JPG / WebP / GIF (max 10 MB).
2. The client POSTs the file to `/api/extract`. Gemini returns labelled fields, evidence snippets, and full OCR text.
3. The form stays locked until extraction succeeds. The user can edit values (including extra labelled fields) and **Save details**.
4. Save unlocks chat. Questions go to `/api/chat`. The agent answers only from saved fields and OCR text; saved fields win if they disagree.

### Main modules

| Path                               | Role                                      |
| ---------------------------------- | ----------------------------------------- |
| `app/page.tsx`                     | Home page: `DocumentWorkspace`            |
| `components/DocumentWorkspace.tsx` | Upload, extract, form/chat tabs           |
| `components/DocumentUploader.tsx`  | Image dropzone + preview                  |
| `components/LicenceForm.tsx`       | Review/correct extracted fields           |
| `components/DocumentChat.tsx`      | Streaming Q&A UI                          |
| `context/document-session.tsx`     | In-memory session                         |
| `app/api/extract/route.ts`         | Image upload + extraction                 |
| `app/api/chat/route.ts`            | Document Q&A agent                        |
| `lib/extract-licence.ts`           | Vision call + licence validity check      |
| `lib/licence-schema.ts`            | Shared Zod schemas and date normalisation |
| `lib/gemini.ts`                    | Model factory and safe error mapping      |
| `prompts/`                         | System prompts for extract and chat       |

## Setup / run

### Prerequisites

- Node.js 20+ (Next.js 16)
- npm
- A [Google AI Studio](https://aistudio.google.com/apikey) API key and a Gemini model that supports vision plus structured output

### Environment

Create `.env.local` in the project root (this file is gitignored):

```bash
GEMINI_API_KEY=your_api_key
GEMINI_MODEL=gemini-2.5-flash
```

`GEMINI_MODEL` is read at runtime. Use a current Gemini model that accepts images and JSON schemas. Thinking-heavy Gemini 3 models need extra token budget for a visible answer; this app already sets chat thinking to `LOW`.

### Commands

```bash
npm install
npm run dev      # http://localhost:3000
npm run lint
npm run build
npm start        # production server after build
```

### Try the workspace

1. Open http://localhost:3000
2. Upload a clear driving licence photo
3. Confirm or edit the form, then save
4. Ask a question (for example: “What is the licence expiry date?”)

## AI / LLM approach

Two Gemini calls, two jobs. The image is not sent again at chat time.

### 1. Extraction (`/api/extract`)

- Multimodal `HumanMessage`: instruction text + `data:` image URL
- `withStructuredOutput(licenceExtractionSchema)` so the model returns typed fields instead of free-form JSON
- Temperature `0`; streaming off
- Prompt rules: copy visible text only, omit uncertain values, treat image text as untrusted, omit every licence field if the photo is not a licence
- Post-parse: Zod + “at least one real field” check. Failures become `invalid licence` (HTTP 400)
- Dates are normalised to `YYYY-MM-DD` for `<input type="date">`. Numeric dates are treated as day-first (`DD/MM/YYYY`)
- Evidence snippets become per-field source notes in the form

### 2. Chat (`/api/chat`)

- LangChain `createAgent` with a LangGraph `MemorySaver` checkpointer keyed by `threadId` (the client document UUID)
- Dynamic system prompt: chat rules + saved fields + OCR text
- Saved fields are authoritative when they conflict with OCR
- The client sends the latest user turn; earlier turns for that thread live in the checkpointer
- Stream is `text/plain`. Visible tokens are taken from message chunks, with a final `updates` fallback if thinking consumed the stream
- Thinking tokens are stripped; chat thinking level is `LOW` so Gemini 3 does not spend the whole output budget on hidden reasoning
- If the model still returns empty text, the UI shows an error instead of hanging on “Thinking…”

### Grounding and safety

- Chat is instructed not to invent names, dates, or numbers, and to say when the answer is not in the document
- Document text is treated as data, not instructions (prompt-injection resistance)
- API errors are sanitised before logging; clients get generic messages rather than provider payloads
- Missing `GEMINI_API_KEY` / `GEMINI_MODEL` surfaces as HTTP 503

## Key technical decisions

- **Vision LLM instead of a separate OCR engine.** Gemini reads the photo and fills the schema in one step, which is more reliable on plastic cards than Tesseract for this workload.
- **Human review before chat.** Chat stays disabled until the user saves. That makes corrected form values the source of truth.
- **No database.** Session state is React context; chat memory is an in-process `MemorySaver` on `globalThis` so Next.js hot reload does not drop the checkpointer.
- **Images only.** Licences are photographed cards. PDF / multi-page pipelines were left out of scope.
- **Optional fields, not JSON null unions.** Gemini rejects `type: ["string", "null"]`. The extract schema uses optional strings and coerces leftover `null`s while parsing.
- **Shared Zod types.** One schema family drives the form, extract response, and chat request so the UI cannot drift from the API.
- **Plain-text chat stream.** Simpler client parsing than SSE/JSON event streams; `Cache-Control: no-store` and `X-Accel-Buffering: no` reduce proxy buffering.
- **Node.js route runtime.** Needed for `Buffer` image encoding and LangChain’s Node APIs.

## Known limitations

- **Ephemeral.** Refreshing the tab clears the session. Restarting the Next.js process clears chat memory. Multiple server instances do not share the checkpointer.
- **PII leaves the browser.** Licence photos and extracted text are sent to Google Gemini. Do not use real documents in shared or production environments without a privacy review.
- **Single image, single document.** No PDFs, no multi-page scans, no batch upload.
- **Extraction quality depends on the photo.** Glare, crop, handwriting, and unusual licence layouts can omit fields or fail the “invalid licence” check.
- **Date handling is opinionated.** Incomplete or ambiguous dates are dropped. Day/month order can be wrong on US-style numeric dates.
- **Chat context is bounded.** OCR text is capped at 80 000 characters on the chat request. The agent has no tools and cannot look at the original image again.
- **No auth, rate limiting, or abuse controls** on the API routes.
- **Gemini 3 thinking.** Even with `LOW` thinking, some models can still return empty visible text under tight token budgets.

## AI development tools used

This app was built in **Cursor**, with an AI coding assistant used for implementation, debugging, and browser checks. Supporting tools in that loop:

| Tool                                 | Use                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Cursor                               | Primary IDE and agent: scaffolding, LangChain/Gemini integration, schema and stream fixes |
| shadcn/ui (CLI + MCP)                | Base Nova components (`attachment`, form, tabs, card)                                     |
| Cursor Browser + Chrome DevTools MCP | End-to-end checks of upload, extract, save, and streaming chat                            |
| Next.js `AGENTS.md`                  | In-repo guidance for this Next.js 16 tree                                                 |
| LangChain / Google Gemini docs       | Agent, structured output, and thinking-config behaviour                                   |

Runtime inference is Gemini only. There is no second model in the product path.
