"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  emptyLicenceFields,
  type ExtractApiResponse,
  type FieldSources,
  type LicenceFields,
} from "@/lib/licence-schema";

export type ExtractionStatus =
  | "idle"
  | "extracting"
  | "ready"
  | "extract-error";

type DocumentSessionContextValue = {
  file: File | null;
  previewUrl: string | null;
  documentId: string | null;
  ocrText: string;
  fields: LicenceFields;
  setFields: (fields: LicenceFields) => void;
  fieldSources: FieldSources;
  saved: boolean;
  save: () => void;
  extractionStatus: ExtractionStatus;
  error: string | null;
  selectFile: (file: File) => void;
  clear: () => void;
  completeExtract: (result: ExtractApiResponse) => void;
  failExtract: (message: string) => void;
};

const DocumentSessionContext =
  createContext<DocumentSessionContextValue | null>(null);

function revokePreview(url: string | null) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

export function DocumentSessionProvider({ children }: { children: ReactNode }) {
  const previewUrlRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [fields, setFields] = useState<LicenceFields>(emptyLicenceFields);
  const [fieldSources, setFieldSources] = useState<FieldSources>({});
  const [saved, setSaved] = useState(false);
  const [extractionStatus, setExtractionStatus] =
    useState<ExtractionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      revokePreview(previewUrlRef.current);
    };
  }, []);

  const resetSession = useCallback(() => {
    revokePreview(previewUrlRef.current);
    previewUrlRef.current = null;
    setFile(null);
    setPreviewUrl(null);
    setDocumentId(null);
    setOcrText("");
    setFields(emptyLicenceFields);
    setFieldSources({});
    setSaved(false);
    setExtractionStatus("idle");
    setError(null);
  }, []);

  const selectFile = useCallback((nextFile: File) => {
    revokePreview(previewUrlRef.current);
    const nextUrl = URL.createObjectURL(nextFile);
    previewUrlRef.current = nextUrl;
    setFile(nextFile);
    setPreviewUrl(nextUrl);
    setDocumentId(crypto.randomUUID());
    setOcrText("");
    setFields(emptyLicenceFields);
    setFieldSources({});
    setSaved(false);
    setExtractionStatus("extracting");
    setError(null);
  }, []);

  const completeExtract = useCallback((result: ExtractApiResponse) => {
    setFields(result.fields);
    setFieldSources(result.fieldSources);
    setOcrText(result.ocrText);
    setExtractionStatus("ready");
    setError(null);
  }, []);

  const failExtract = useCallback((message: string) => {
    setExtractionStatus("extract-error");
    setError(message);
  }, []);

  const save = useCallback(() => {
    setSaved(true);
  }, []);

  const value = useMemo(
    () => ({
      file,
      previewUrl,
      documentId,
      ocrText,
      fields,
      setFields,
      fieldSources,
      saved,
      save,
      extractionStatus,
      error,
      selectFile,
      clear: resetSession,
      completeExtract,
      failExtract,
    }),
    [
      file,
      previewUrl,
      documentId,
      ocrText,
      fields,
      fieldSources,
      saved,
      save,
      extractionStatus,
      error,
      selectFile,
      resetSession,
      completeExtract,
      failExtract,
    ],
  );

  return (
    <DocumentSessionContext.Provider value={value}>
      {children}
    </DocumentSessionContext.Provider>
  );
}

export function useDocumentSession() {
  const context = useContext(DocumentSessionContext);

  if (!context) {
    throw new Error(
      "useDocumentSession must be used within DocumentSessionProvider",
    );
  }

  return context;
}
