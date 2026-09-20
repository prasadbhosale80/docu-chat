"use client";

import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LicenceFields } from "@/lib/licence-schema";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What is the licence expiry date?",
  "What vehicles is this person authorised to drive?",
  "What is the licence number?",
];

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

async function readApiError(response: Response) {
  try {
    const data: unknown = await response.json();
    if (
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string" &&
      data.error
    ) {
      return data.error;
    }
  } catch {
    // Ignore non-JSON error bodies.
  }

  return `Unable to answer from this document (${response.status}).`;
}

export function DocumentChat(props: {
  threadId: string;
  fields: LicenceFields;
  ocrText: string;
  disabled?: boolean;
}) {
  if (props.disabled) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
        Save the form to ask questions about the document.
      </div>
    );
  }

  return <EnabledDocumentChat {...props} />;
}

function EnabledDocumentChat({
  threadId,
  fields,
  ocrText,
}: {
  threadId: string;
  fields: LicenceFields;
  ocrText: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    const history = messages;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };

    setInput("");
    setError(null);
    setIsStreaming(true);
    setMessages([...history, userMessage, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          messages: [{ role: userMessage.role, content: userMessage.content }],
          fields,
          ocrText,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(await readApiError(response));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        assistantText += decoder.decode(value, { stream: true });
        const nextText = assistantText;
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: nextText }
              : message,
          ),
        );
      }

      assistantText += decoder.decode();
      if (!assistantText.trim()) {
        throw new Error("The model returned an empty answer. Please retry shortly.");
      }
    } catch (sendError) {
      if (controller.signal.aborted) {
        return;
      }
      setMessages((current) =>
        current.filter(
          (message) =>
            message.id !== assistantMessage.id || message.content.trim(),
        ),
      );
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Unable to answer from this document right now.",
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsStreaming(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setIsStreaming(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border bg-card">
      {error ? (
        <p className="px-4 pt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-center text-sm font-medium">Try these prompts</p>
            <div className="grid gap-2 sm:grid-cols-1">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-lg border bg-background p-3 text-left text-sm hover:bg-muted"
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                  message.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {message.role === "assistant" ? (
                  message.content ? (
                    <div className="[&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Thinking…</span>
                  )
                ) : (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about this licence…"
          rows={1}
          className="min-h-10 resize-none"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
        />
        {isStreaming ? (
          <Button type="button" size="icon" onClick={stop} aria-label="Stop">
            <Square />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim()}
            aria-label="Send"
          >
            <ArrowUp />
          </Button>
        )}
      </form>
    </div>
  );
}
