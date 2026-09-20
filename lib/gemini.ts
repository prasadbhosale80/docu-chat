import "server-only";

import {
  ChatGoogleGenerativeAI,
  type GoogleGenerativeAIChatInput,
} from "@langchain/google-genai";

export class ConfigurationError extends Error {
  constructor(message = "AI service is not configured.") {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class UpstreamError extends Error {
  constructor(message = "The AI provider failed. Please retry shortly.") {
    super(message);
    this.name = "UpstreamError";
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConfigurationError(`${name} is not configured.`);
  }
  return value;
}

export function getGeminiModel(options?: {
  temperature?: number;
  maxOutputTokens?: number;
  streaming?: boolean;
  thinkingConfig?: GoogleGenerativeAIChatInput["thinkingConfig"];
}) {
  return new ChatGoogleGenerativeAI({
    model: requireEnv("GEMINI_MODEL"),
    apiKey: requireEnv("GEMINI_API_KEY"),
    temperature: options?.temperature ?? 0.2,
    maxOutputTokens: options?.maxOutputTokens ?? 2048,
    maxRetries: 1,
    streaming: options?.streaming ?? true,
    thinkingConfig: options?.thinkingConfig,
  });
}

export function logSafeError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const sanitized = message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
  console.error(`[${scope}] ${sanitized.slice(0, 400)}`);
}

export function publicAiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ConfigurationError || error instanceof UpstreamError) {
    return error.message;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|unauthorized|invalid api key/i.test(message)) {
    return "AI service rejected the configured API key.";
  }
  if (
    /429|rate[- ]limit|timeout|ETIMEDOUT|502|503|504|aborted|Provider returned error/i.test(
      message,
    )
  ) {
    return "The AI provider failed. Please retry shortly.";
  }

  return fallback;
}

export function aiErrorStatus(error: unknown) {
  if (error instanceof ConfigurationError) {
    return 503;
  }
  if (error instanceof UpstreamError) {
    return 502;
  }
  return 500;
}
