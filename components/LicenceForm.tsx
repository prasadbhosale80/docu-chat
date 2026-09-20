"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useDocumentSession,
  type ExtractionStatus,
} from "@/context/document-session";
import {
  LICENCE_FORM_FIELDS,
  licenceFormSchema,
  type FieldSource,
  type LicenceFormValues,
} from "@/lib/licence-schema";

function FieldSourceNote({ source }: { source?: FieldSource }) {
  if (!source?.snippet) {
    return null;
  }

  const note =
    source.page != null
      ? `${source.snippet} · page ${source.page}`
      : source.snippet;

  return <FieldDescription>{note}</FieldDescription>;
}

function formDescription(status: ExtractionStatus, error: string | null) {
  if (status === "extracting") {
    return "Reading the licence photo. The form unlocks when extraction finishes.";
  }
  if (status === "extract-error") {
    return (
      error ??
      "Could not extract licence fields. Upload a new photo to try again."
    );
  }
  return "Review and correct the extracted fields, then save to unlock chat.";
}

function footerNote(
  formEnabled: boolean,
  status: ExtractionStatus,
  saved: boolean,
) {
  if (!formEnabled) {
    return status === "extracting"
      ? "Waiting for extracted details…"
      : "Form stays locked until extraction succeeds.";
  }
  return saved
    ? "Values confirmed for this session. Chat is unlocked."
    : "Nothing is stored beyond this browser session.";
}

export function LicenceForm({ onSaved }: { onSaved?: () => void }) {
  const {
    fields,
    fieldSources,
    setFields,
    save,
    saved,
    extractionStatus,
    error,
  } = useDocumentSession();
  const formEnabled = extractionStatus === "ready";
  const form = useForm<LicenceFormValues>({
    resolver: zodResolver(licenceFormSchema),
    defaultValues: fields,
  });
  const otherFields = useFieldArray({
    control: form.control,
    name: "otherFields",
  });
  const { reset } = form;

  useEffect(() => {
    reset(fields);
  }, [fields, reset]);

  function onSubmit(values: LicenceFormValues) {
    if (!formEnabled) {
      return;
    }
    setFields(values);
    save();
    onSaved?.();
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Licence details</CardTitle>
        <CardDescription>
          {formDescription(extractionStatus, error)}
        </CardDescription>
      </CardHeader>
      <form className="contents" onSubmit={form.handleSubmit(onSubmit)}>
        <CardContent>
          <fieldset disabled={!formEnabled} className="min-w-0 border-0 p-0">
            <FieldGroup>
              {LICENCE_FORM_FIELDS.map((item) => (
                <Field
                  key={item.name}
                  data-invalid={!!form.formState.errors[item.name] || undefined}
                >
                  <FieldLabel htmlFor={item.name}>{item.label}</FieldLabel>
                  {item.kind === "textarea" ? (
                    <Textarea
                      id={item.name}
                      rows={3}
                      aria-invalid={!!form.formState.errors[item.name]}
                      {...form.register(item.name)}
                    />
                  ) : (
                    <Input
                      id={item.name}
                      type={item.kind === "date" ? "date" : "text"}
                      autoComplete={
                        "autoComplete" in item ? item.autoComplete : undefined
                      }
                      aria-invalid={!!form.formState.errors[item.name]}
                      {...form.register(item.name)}
                    />
                  )}
                  <FieldError errors={[form.formState.errors[item.name]]} />
                  <FieldSourceNote source={fieldSources[item.name]} />
                </Field>
              ))}

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Other relevant info</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!formEnabled}
                    onClick={() => otherFields.append({ label: "", value: "" })}
                  >
                    <Plus data-icon="inline-start" />
                    Add field
                  </Button>
                </div>

                {otherFields.fields.map((item, index) => (
                  <div
                    key={item.id}
                    className="grid gap-2 rounded-lg border p-3"
                  >
                    <Field
                      data-invalid={
                        !!form.formState.errors.otherFields?.[index]?.label ||
                        undefined
                      }
                    >
                      <FieldLabel htmlFor={`otherFields.${index}.label`}>
                        Label
                      </FieldLabel>
                      <Input
                        id={`otherFields.${index}.label`}
                        {...form.register(`otherFields.${index}.label`)}
                      />
                      <FieldError
                        errors={[
                          form.formState.errors.otherFields?.[index]?.label,
                        ]}
                      />
                    </Field>
                    <Field
                      data-invalid={
                        !!form.formState.errors.otherFields?.[index]?.value ||
                        undefined
                      }
                    >
                      <FieldLabel htmlFor={`otherFields.${index}.value`}>
                        Value
                      </FieldLabel>
                      <Textarea
                        id={`otherFields.${index}.value`}
                        rows={2}
                        {...form.register(`otherFields.${index}.value`)}
                      />
                      <FieldError
                        errors={[
                          form.formState.errors.otherFields?.[index]?.value,
                        ]}
                      />
                      <FieldSourceNote
                        source={
                          fieldSources[`otherFields.${index}`] ??
                          fieldSources[item.label]
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() => otherFields.remove(index)}
                    >
                      <Trash2 data-icon="inline-start" />
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </FieldGroup>
          </fieldset>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {footerNote(formEnabled, extractionStatus, saved)}
          </span>
          <Button type="submit" disabled={!formEnabled}>
            {saved ? "Update saved details" : "Save details"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
