import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, dynamicSystemPromptMiddleware } from "langchain";
import { z } from "zod";

import {
  aiErrorStatus,
  getGeminiModel,
  logSafeError,
  publicAiErrorMessage,
  UpstreamError,
} from "@/lib/gemini";
import { chatRequestSchema, formatLicenceFields } from "@/lib/licence-schema";
import { ASK_DOCUMENT_SYSTEM_PROMPT } from "@/prompts/ask-document";

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
  return createAgent({
    model: getGeminiModel({
      maxOutputTokens: 8192,
      // Gemini 3 defaults to high thinking, which can spend the whole
      // token budget on hidden reasoning and stream no visible text.
      thinkingConfig: { thinkingLevel: "LOW" },
    }),
    checkpointer: getCheckpointer(),
    contextSchema: documentContextSchema,
    middleware: [
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

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (!block || typeof block !== "object") {
        return "";
      }

      const item = block as { type?: unknown; text?: unknown };
      if (item.type === "thinking" || item.type === "reasoning") {
        return "";
      }
      return typeof item.text === "string" ? item.text : "";
    })
    .join("");
}

function aiMessageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  if (AIMessage.isInstance(message)) {
    return message.text || contentToText(message.content);
  }

  const value = message as {
    type?: unknown;
    id?: unknown;
    content?: unknown;
    text?: unknown;
    kwargs?: { type?: unknown; content?: unknown };
  };
  const kwargs = value.kwargs;
  const type = kwargs?.type ?? value.type;
  const id = Array.isArray(value.id) ? value.id.join(".") : "";
  const isAi = type === "ai" || id.includes("AIMessage");
  if (!isAi) {
    return "";
  }

  return typeof value.text === "string" && value.text
    ? value.text
    : contentToText(kwargs?.content ?? value.content);
}

function streamToken(event: unknown): unknown {
  if (!Array.isArray(event)) {
    return event;
  }

  // streamMode: ["messages", "updates"] => ["messages", [token, metadata]]
  if (event[0] === "messages") {
    const payload = event[1];
    return Array.isArray(payload) ? payload[0] : payload;
  }

  if (event[0] === "updates") {
    return undefined;
  }

  // streamMode: "messages" => [token, metadata]
  return event[0];
}

function updatesFallbackText(event: unknown): string {
  if (!Array.isArray(event) || event[0] !== "updates") {
    return "";
  }

  const update = event[1];
  if (!update || typeof update !== "object") {
    return "";
  }

  let latest = "";
  for (const node of Object.values(update as Record<string, unknown>)) {
    if (!node || typeof node !== "object" || !("messages" in node)) {
      continue;
    }

    const messages = (node as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) {
      continue;
    }

    for (const message of messages) {
      const text = aiMessageText(message);
      if (text) {
        latest = text;
      }
    }
  }

  return latest;
}

export async function POST(request: Request) {
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

    const { threadId, messages, fields, ocrText } = parsed.data;
    const lastUser = [...messages]
      .reverse()
      .find((message) => message.role === "user");

    if (!lastUser) {
      return Response.json(
        { error: "A user question is required." },
        { status: 400 },
      );
    }

    const agentStream = await createDocumentAgent().stream(
      {
        messages: [{ role: "user", content: lastUser.content }],
      },
      {
        configurable: { thread_id: threadId },
        context: {
          fieldsText: formatLicenceFields(fields),
          ocrText: ocrText?.trim() || "(none)",
        },
        streamMode: ["messages", "updates"],
        signal: request.signal,
      },
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let streamedText = "";
          let fallbackText = "";

          const enqueueVisibleText = (text: string) => {
            if (!text) {
              return;
            }
            if (streamedText && text === streamedText) {
              return;
            }
            if (streamedText && text.startsWith(streamedText)) {
              const delta = text.slice(streamedText.length);
              if (delta) {
                streamedText = text;
                controller.enqueue(encoder.encode(delta));
              }
              return;
            }
            streamedText += text;
            controller.enqueue(encoder.encode(text));
          };

          for await (const event of agentStream) {
            const token = streamToken(event);
            if (token !== undefined) {
              enqueueVisibleText(aiMessageText(token));
            }

            const updateText = updatesFallbackText(event);
            if (updateText) {
              fallbackText = updateText;
            }
          }

          if (!streamedText && fallbackText) {
            enqueueVisibleText(fallbackText);
          }

          if (!streamedText.trim()) {
            logSafeError(
              "chat",
              new UpstreamError("The model returned an empty answer."),
            );
          }

          controller.close();
        } catch (error) {
          if (request.signal.aborted) {
            controller.close();
            return;
          }
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
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
