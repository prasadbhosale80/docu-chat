"use client";

import { ChevronDown, FileText, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";

import { DocumentChat } from "@/components/DocumentChat";
import { DocumentUploader } from "@/components/DocumentUploader";
import { LicenceForm } from "@/components/LicenceForm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentSession } from "@/context/document-session";
import { extractResponseSchema } from "@/lib/licence-schema";

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

  return `Could not extract licence fields (${response.status}).`;
}

export function DocumentWorkspace() {
  const {
    file,
    documentId,
    ocrText,
    extractionStatus,
    error,
    saved,
    fields,
    completeExtract,
    failExtract,
  } = useDocumentSession();
  const [tab, setTab] = useState<"form" | "chat">("form");
  const formReady = extractionStatus === "ready";
  const activeTab = saved && formReady ? tab : "form";

  useEffect(() => {
    if (!file || !documentId) {
      return;
    }

    let cancelled = false;
    const body = new FormData();
    body.append("file", file);

    fetch("/api/extract", { method: "POST", body })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }
        const payload = extractResponseSchema.safeParse(await response.json());
        if (!payload.success) {
          throw new Error("Could not read the extracted licence fields.");
        }
        return payload.data;
      })
      .then((payload) => {
        if (!cancelled) {
          completeExtract(payload);
        }
      })
      .catch((extractError: unknown) => {
        if (cancelled) {
          return;
        }
        failExtract(
          extractError instanceof Error
            ? extractError.message
            : "Could not extract licence fields.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [completeExtract, documentId, failExtract, file]);

  return (
    <div className="flex flex-1 flex-col px-6 py-10">
      <div
        className={
          file
            ? "mx-auto w-full max-w-6xl space-y-6"
            : "mx-auto w-full max-w-2xl space-y-4"
        }
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Driving licence workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload a licence photo, check the extracted details, then save to
            start chatting about this document.
          </p>
        </div>

        {!file ? <DocumentUploader /> : null}

        {file ? (
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="min-w-0 space-y-4 lg:sticky lg:top-6">
              <DocumentUploader />

              {extractionStatus === "extracting" ? (
                <p className="text-sm text-muted-foreground">
                  Reading the licence photo…
                </p>
              ) : null}

              {error && extractionStatus === "extract-error" ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              {ocrText ? (
                <Card>
                  <CardHeader className="border-b">
                    <CardTitle>Document text</CardTitle>
                    <CardDescription>
                      Text extracted from the licence photo
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Collapsible defaultOpen={false}>
                      <CollapsibleTrigger className="flex w-full items-center justify-between py-2 text-sm font-medium">
                        Extracted text
                        <ChevronDown className="size-4 text-muted-foreground" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
                          {ocrText}
                        </p>
                      </CollapsibleContent>
                    </Collapsible>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <Tabs
              className="min-w-0"
              value={activeTab}
              onValueChange={(value) => {
                if (value === "form" || value === "chat") {
                  setTab(value);
                }
              }}
            >
              <TabsList className="w-full">
                <TabsTrigger value="form">
                  <FileText data-icon="inline-start" />
                  Form
                </TabsTrigger>
                <TabsTrigger
                  value="chat"
                  disabled={!saved}
                  title={saved ? undefined : "Save the form to unlock chat"}
                >
                  <MessageSquare data-icon="inline-start" />
                  Chat
                </TabsTrigger>
              </TabsList>
              <TabsContent value="form" keepMounted>
                <LicenceForm onSaved={() => setTab("chat")} />
              </TabsContent>
              <TabsContent value="chat" keepMounted className="h-112 flex-none">
                {documentId ? (
                  <DocumentChat
                    key={documentId}
                    threadId={documentId}
                    fields={fields}
                    ocrText={ocrText}
                    disabled={!saved}
                  />
                ) : null}
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </div>
    </div>
  );
}
