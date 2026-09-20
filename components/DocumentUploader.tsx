"use client";

import { ImagePlus, X } from "lucide-react";
import {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { useDocumentSession } from "@/context/document-session";
import { IMAGE_ACCEPT, imageMimeType, MAX_IMAGE_BYTES } from "@/lib/upload";
import { cn } from "@/lib/utils";

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function DocumentUploader() {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { file, previewUrl, extractionStatus, selectFile, clear } =
    useDocumentSession();

  const addFile = useCallback(
    (nextFile: File | undefined) => {
      if (!nextFile) {
        return;
      }
      if (previewUrl) {
        setFileError("Remove the current image to add another.");
        return;
      }
      if (!imageMimeType(nextFile)) {
        setFileError("Only PNG, JPG, WebP, or GIF images are supported.");
        return;
      }
      if (nextFile.size > MAX_IMAGE_BYTES) {
        setFileError("This image is larger than 10 MB.");
        return;
      }
      setFileError(null);
      selectFile(nextFile);
    },
    [previewUrl, selectFile],
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      addFile(event.target.files?.[0]);
      event.target.value = "";
    },
    [addFile],
  );

  const handleDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (previewUrl) {
        return;
      }
      dragDepthRef.current += 1;
      setIsDragging(true);
    },
    [previewUrl],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = previewUrl ? "none" : "copy";
    },
    [previewUrl],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      addFile(event.dataTransfer.files[0]);
    },
    [addFile],
  );

  const isProcessing = extractionStatus === "extracting";
  const attachmentState =
    extractionStatus === "extract-error"
      ? "error"
      : isProcessing
        ? "processing"
        : file
          ? "done"
          : "idle";

  return (
    <div
      className="flex w-full flex-col gap-3"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {!file ? (
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          onChange={handleInputChange}
        />
      ) : null}

      {file && previewUrl ? (
        <Attachment
          orientation="vertical"
          state={attachmentState}
          className="w-full has-data-[slot=attachment-content]:w-full"
        >
          <AttachmentMedia
            variant="image"
            className="aspect-[4/3] w-full *:[img]:aspect-[4/3]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt={file.name} />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{file.name}</AttachmentTitle>
            <AttachmentDescription>
              {isProcessing
                ? "Reading licence photo…"
                : `${imageMimeType(file)?.split("/")[1]?.toUpperCase() ?? "IMAGE"} · ${formatFileSize(file.size)}`}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              aria-label={`Remove ${file.name}`}
              onClick={() => {
                setFileError(null);
                clear();
              }}
            >
              <X />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ) : (
        <Attachment
          state="idle"
          className={cn(
            "w-full flex-col items-center justify-center gap-3 px-6 py-16",
            isDragging && "border-ring bg-muted/40",
          )}
        >
          <AttachmentMedia>
            <ImagePlus />
          </AttachmentMedia>
          <AttachmentContent className="text-center">
            <AttachmentTitle>Drop a driving licence photo</AttachmentTitle>
            <AttachmentDescription>
              PNG, JPG, WebP, or GIF · up to 10 MB
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentTrigger
            aria-label="Upload driving licence"
            onClick={() => inputRef.current?.click()}
          />
        </Attachment>
      )}

      {fileError ? (
        <p className="text-sm text-destructive" role="alert">
          {fileError}
        </p>
      ) : null}
    </div>
  );
}
