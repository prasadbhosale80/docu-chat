import { NextResponse } from "next/server";

import {
  extractLicenceFromImage,
  InvalidLicenceError,
} from "@/lib/extract-licence";
import {
  aiErrorStatus,
  logSafeError,
  publicAiErrorMessage,
} from "@/lib/gemini";
import { toExtractResponse } from "@/lib/licence-schema";
import { imageMimeType, MAX_IMAGE_BYTES } from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "A licence image is required." },
        { status: 400 },
      );
    }

    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "A licence image is required." },
        { status: 400 },
      );
    }

    const mimeType = imageMimeType(file);
    if (!mimeType) {
      return NextResponse.json(
        { error: "Only PNG, JPG, WebP, or GIF images are supported." },
        { status: 400 },
      );
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "This image is larger than 10 MB." },
        { status: 413 },
      );
    }

    const extraction = await extractLicenceFromImage({
      image: new Uint8Array(await file.arrayBuffer()),
      mimeType,
    });

    return NextResponse.json(toExtractResponse(extraction));
  } catch (error) {
    if (error instanceof InvalidLicenceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    logSafeError("extract", error);
    return NextResponse.json(
      {
        error: publicAiErrorMessage(
          error,
          "Unable to extract licence fields from this document.",
        ),
      },
      { status: aiErrorStatus(error) },
    );
  }
}
