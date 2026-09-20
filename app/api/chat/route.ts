import { MemorySaver } from "@langchain/langgraph";
import {
  createAgent,
  dynamicSystemPromptMiddleware,
  summarizationMiddleware,
} from "langchain";
import { z } from "zod";

import {
  aiErrorStatus,
  getGeminiModel,
  logSafeError,
  publicAiErrorMessage,
  UpstreamError,
} from "@/lib/gemini";
import { chatRequestSchema, formatLicenceFields } from "@/lib/licence-schema";
import { enforceChatRateLimit } from "@/lib/rate-limit";
import {
  ASK_DOCUMENT_SYSTEM_PROMPT,
  CONVERSATION_SUMMARY_PROMPT,
} from "@/prompts/ask-document";

export const runtime = "nodejs";
export const maxDuration = 60;

const documentContextSchema = z.object({
  fieldsText: z.string(),
  ocrText: z.string(),
});

type DocumentContext = z.infer<typeof documentContextSchema>;

const globalForChat = globalThis as typeof globalThis & {
  documentChatCheckpointer?: MemorySaver;
};

function getCheckpointer() {
  globalForChat.documentChatCheckpointer ??= new MemorySaver();
  return globalForChat.documentChatCheckpointer;
}

function createDocumentAgent() {
  const model = getGeminiModel({
    maxOutputTokens: 8192,
    streaming: false,
    // Gemini 3 defaults to high thinking, which can spend the whole
    // token budget on hidden reasoning and return no visible text.
    thinkingConfig: { thinkingLevel: "LOW" },
  });

  return createAgent({
    model,
    checkpointer: getCheckpointer(),
    contextSchema: documentContextSchema,
    middleware: [
      summarizationMiddleware({
        model: getGeminiModel({
          temperature: 0,
          maxOutputTokens: 1024,
          streaming: false,
          thinkingConfig: { thinkingBudget: 0 },
        }),
        trigger: { messages: 10 },
        keep: { messages: 6 },
        summaryPrompt: CONVERSATION_SUMMARY_PROMPT,
      }),
      dynamicSystemPromptMiddleware<DocumentContext>((_state, runtime) =>
        [
          ASK_DOCUMENT_SYSTEM_PROMPT,
          `Saved fields (authoritative; prefer these if they conflict with document text):\n${runtime.context.fieldsText}`,
          `Document text:\n${runtime.context.ocrText}`,
        ].join("\n\n"),
      ),
    ],
  });
}

export async function POST(request: Request) {
  const limited = await enforceChatRateLimit(request);
  if (limited) {
    return limited;
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid request." }, { status: 400 });
    }

    const { threadId, question, fields, ocrText } = parsed.data;

    const result = await createDocumentAgent().invoke(
      {
        messages: [{ role: "user", content: question }],
      },
      {
        configurable: { thread_id: threadId },
        context: {
          fieldsText: formatLicenceFields(fields),
          ocrText: ocrText?.trim() || "(none)",
        },
        signal: request.signal,
      },
    );

    const lastMessage = result.messages.at(-1);
    const content =
      typeof lastMessage?.content === "string"
        ? lastMessage.content.trim()
        : "";
    if (!content) {
      throw new UpstreamError("The model returned an empty answer.");
    }

    return Response.json({ content });
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 204 });
    }

    logSafeError("chat", error);
    return Response.json(
      {
        error: publicAiErrorMessage(
          error,
          "Unable to answer from this document right now.",
        ),
      },
      { status: aiErrorStatus(error) },
    );
  }
}
