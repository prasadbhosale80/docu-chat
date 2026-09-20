import "server-only";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  ConfigurationError,
  getGeminiModel,
  logSafeError,
  UpstreamError,
} from "@/lib/gemini";
import {
  licenceExtractionSchema,
  type LicenceExtraction,
} from "@/lib/licence-schema";
import { EXTRACT_LICENCE_SYSTEM_PROMPT } from "@/prompts/extract-licence";

export class InvalidLicenceError extends Error {
  constructor() {
    super("invalid licence");
    this.name = "InvalidLicenceError";
  }
}

const LICENCE_TEXT_FIELDS = [
  "fullName",
  "licenceNumber",
  "dateOfBirth",
  "dateOfIssue",
  "dateOfExpiry",
  "address",
  "vehicleClasses",
  "issuingAuthority",
] as const satisfies ReadonlyArray<keyof LicenceExtraction>;

function hasLicenceFields(data: LicenceExtraction) {
  if (LICENCE_TEXT_FIELDS.some((key) => Boolean(data[key]?.trim()))) {
    return true;
  }

  return (data.otherFields ?? []).some(
    (field) => field.label.trim() && field.value.trim(),
  );
}

function assertValidLicence(extraction: unknown): LicenceExtraction {
  const parsed = licenceExtractionSchema.safeParse(extraction);
  if (!parsed.success || !hasLicenceFields(parsed.data)) {
    throw new InvalidLicenceError();
  }

  return parsed.data;
}

export async function extractLicenceFromImage(input: {
  image: Uint8Array;
  mimeType: string;
}): Promise<LicenceExtraction> {
  try {
    const model = getGeminiModel({
      temperature: 0,
      maxOutputTokens: 4096,
      streaming: false,
      thinkingConfig: { thinkingBudget: 0 },
    }).withStructuredOutput<LicenceExtraction>(licenceExtractionSchema, {
      name: "licence_extraction",
    });

    const extraction = await model.invoke([
      new SystemMessage(EXTRACT_LICENCE_SYSTEM_PROMPT),
      new HumanMessage({
        content: [
          {
            type: "text",
            text: "Extract the driving licence fields and all visible text from this photo. Do not invent values.",
          },
          {
            type: "image_url",
            image_url: `data:${input.mimeType};base64,${Buffer.from(input.image).toString("base64")}`,
          },
        ],
      }),
    ]);

    return assertValidLicence(extraction);
  } catch (error) {
    if (
      error instanceof InvalidLicenceError ||
      error instanceof ConfigurationError ||
      error instanceof UpstreamError
    ) {
      throw error;
    }

    logSafeError("extract.generate", error);
    throw new UpstreamError();
  }
}
