"use client";

import type { ReactNode } from "react";

import { DocumentSessionProvider } from "@/context/document-session";

export function Providers({ children }: { children: ReactNode }) {
  return <DocumentSessionProvider>{children}</DocumentSessionProvider>;
}
