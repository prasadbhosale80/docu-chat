import { z } from "zod";

export const licenceOtherFieldSchema = z.object({
  label: z.string().max(200),
  value: z.string().max(2000),
});

export const licenceFieldsSchema = z.object({
  fullName: z.string().max(120),
  licenceNumber: z.string().max(40),
  dateOfBirth: z.string().max(32),
  dateOfIssue: z.string().max(32),
  dateOfExpiry: z.string().max(32),
  address: z.string().max(2000),
  vehicleClasses: z.string().max(2000),
  issuingAuthority: z.string().max(2000),
  otherFields: z.array(licenceOtherFieldSchema).max(40),
});

const optionalIsoDate = z
  .string()
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Enter a valid date",
  });

export const licenceFormSchema = licenceFieldsSchema.extend({
  fullName: z.string().max(120, "Name must be 120 characters or fewer"),
  licenceNumber: z
    .string()
    .max(40, "Licence number must be 40 characters or fewer"),
  dateOfBirth: optionalIsoDate,
  dateOfIssue: optionalIsoDate,
  dateOfExpiry: optionalIsoDate,
});

export const fieldSourceSchema = z.object({
  snippet: z.string().min(1).max(400),
  page: z.number().int().positive().optional(),
});

export const fieldSourcesSchema = z.record(z.string(), fieldSourceSchema);

// Gemini rejects JSON Schema unions such as type: ["string", "null"].
// Keep fields optional in the response schema, and coerce leftover nulls while parsing.
function omitNull<T extends z.ZodTypeAny>(schema: T): T {
  return z.preprocess(
    (value) => (value === null ? undefined : value),
    schema,
  ) as unknown as T;
}

const optionalText = (description: string) =>
  omitNull(z.string().describe(description).optional());

export const licenceEvidenceSchema = z.object({
  field: z.string().describe("Field key such as fullName or otherFields.0"),
  snippet: z
    .string()
    .describe("Short excerpt copied from the image that contains the value"),
});

export const licenceExtractionSchema = z.object({
  ocrText: z
    .string()
    .describe("Every readable line from the image, preserving line breaks"),
  fullName: optionalText("Full name as printed"),
  licenceNumber: optionalText("Driving licence number"),
  dateOfBirth: optionalText("Date of birth as YYYY-MM-DD when complete"),
  dateOfIssue: optionalText("Date of issue as YYYY-MM-DD when complete"),
  dateOfExpiry: optionalText("Date of expiry as YYYY-MM-DD when complete"),
  address: optionalText("Address as printed"),
  vehicleClasses: optionalText("Vehicle classes or licence category"),
  issuingAuthority: optionalText("Issuing authority"),
  otherFields: omitNull(
    z
      .array(licenceOtherFieldSchema)
      .optional()
      .describe("Extra labelled fields visible on the licence"),
  ),
  evidence: omitNull(
    z
      .array(licenceEvidenceSchema)
      .optional()
      .describe("Short snippets proving each extracted field"),
  ),
});

export const chatRequestSchema = z.object({
  threadId: z.string().uuid(),
  question: z.string().min(1).max(4000),
  fields: licenceFieldsSchema.optional(),
  ocrText: z.string().max(80_000).optional(),
});

export const extractResponseSchema = z.object({
  fields: licenceFieldsSchema,
  fieldSources: fieldSourcesSchema,
  ocrText: z.string(),
});

export type LicenceOtherField = z.infer<typeof licenceOtherFieldSchema>;
export type LicenceFields = z.infer<typeof licenceFieldsSchema>;
export type LicenceFormValues = z.infer<typeof licenceFormSchema>;
export type FieldSource = z.infer<typeof fieldSourceSchema>;
export type FieldSources = z.infer<typeof fieldSourcesSchema>;
export type LicenceExtraction = z.infer<typeof licenceExtractionSchema>;
export type ExtractApiResponse = z.infer<typeof extractResponseSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const emptyLicenceFields: LicenceFields = {
  fullName: "",
  licenceNumber: "",
  dateOfBirth: "",
  dateOfIssue: "",
  dateOfExpiry: "",
  address: "",
  vehicleClasses: "",
  issuingAuthority: "",
  otherFields: [],
};

export const LICENCE_FORM_FIELDS = [
  { name: "fullName", label: "Full Name", kind: "text", autoComplete: "name" },
  { name: "licenceNumber", label: "Driving Licence Number", kind: "text" },
  { name: "dateOfBirth", label: "Date of Birth", kind: "date" },
  { name: "dateOfIssue", label: "Date of Issue", kind: "date" },
  { name: "dateOfExpiry", label: "Date of Expiry", kind: "date" },
  { name: "address", label: "Address", kind: "textarea" },
  { name: "vehicleClasses", label: "Vehicle/Class of Licence", kind: "text" },
  { name: "issuingAuthority", label: "Issuing Authority", kind: "text" },
] as const;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function toIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Convert common licence date strings to YYYY-MM-DD for date inputs. */
export function normalizeLicenceDate(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const text = value
    .trim()
    .replace(/[.,;]+$/, "")
    .trim();
  if (!text) {
    return "";
  }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dayFirst = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dayFirst) {
    return toIsoDate(
      Number(dayFirst[3]),
      Number(dayFirst[2]),
      Number(dayFirst[1]),
    );
  }

  const yearFirst = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (yearFirst) {
    return toIsoDate(
      Number(yearFirst[1]),
      Number(yearFirst[2]),
      Number(yearFirst[3]),
    );
  }

  const dayMonthName = text.match(
    /^(\d{1,2})[.\s-]+([A-Za-z]+)[.\s,-]+(\d{4})$/,
  );
  if (dayMonthName) {
    const month = MONTHS[dayMonthName[2].toLowerCase()];
    return month
      ? toIsoDate(Number(dayMonthName[3]), month, Number(dayMonthName[1]))
      : "";
  }

  const monthNameDay = text.match(
    /^([A-Za-z]+)[.\s-]+(\d{1,2})[,\s-]+(\d{4})$/,
  );
  if (monthNameDay) {
    const month = MONTHS[monthNameDay[1].toLowerCase()];
    return month
      ? toIsoDate(Number(monthNameDay[3]), month, Number(monthNameDay[2]))
      : "";
  }

  return "";
}

export function toExtractResponse(
  extraction: LicenceExtraction,
): ExtractApiResponse {
  const fieldSources: FieldSources = {};
  for (const item of extraction.evidence ?? []) {
    const field = item.field.trim();
    const snippet = item.snippet.trim();
    if (field && snippet) {
      fieldSources[field] = { page: 1, snippet: snippet.slice(0, 400) };
    }
  }

  return {
    fields: {
      fullName: extraction.fullName?.trim() ?? "",
      licenceNumber: extraction.licenceNumber?.trim() ?? "",
      dateOfBirth: normalizeLicenceDate(extraction.dateOfBirth),
      dateOfIssue: normalizeLicenceDate(extraction.dateOfIssue),
      dateOfExpiry: normalizeLicenceDate(extraction.dateOfExpiry),
      address: extraction.address?.trim() ?? "",
      vehicleClasses: extraction.vehicleClasses?.trim() ?? "",
      issuingAuthority: extraction.issuingAuthority?.trim() ?? "",
      otherFields: (extraction.otherFields ?? []).filter(
        (field) => field.label.trim() && field.value.trim(),
      ),
    },
    fieldSources,
    ocrText: extraction.ocrText,
  };
}

export function formatLicenceFields(fields?: LicenceFields) {
  if (!fields) {
    return "(none saved)";
  }

  const named = [
    ["fullName", fields.fullName],
    ["licenceNumber", fields.licenceNumber],
    ["dateOfBirth", fields.dateOfBirth],
    ["dateOfIssue", fields.dateOfIssue],
    ["dateOfExpiry", fields.dateOfExpiry],
    ["address", fields.address],
    ["vehicleClasses", fields.vehicleClasses],
    ["issuingAuthority", fields.issuingAuthority],
  ]
    .filter(([, value]) => Boolean(value?.trim()))
    .map(([key, value]) => `${key}: ${value}`);

  const other = fields.otherFields
    .filter((field) => field.label.trim() && field.value.trim())
    .map((field) => `${field.label}: ${field.value}`);

  return [...named, ...other].join("\n") || "(none saved)";
}
