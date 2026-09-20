import "server-only";

import { ipKeyGenerator, rateLimit } from "express-rate-limit";

type RateLimiter = ReturnType<typeof rateLimit>;

type MockResponse = {
  headersSent: boolean;
  writableEnded: boolean;
  statusCode: number;
  setHeader: (name: string, value: string | number) => MockResponse;
  status: (code: number) => MockResponse;
  send: (body: unknown) => MockResponse;
};

const EXTRACT_LIMIT_MESSAGE =
  "Too many extract requests. You can extract 2 documents per minute. Please try again in a minute.";
const CHAT_LIMIT_MESSAGE =
  "Too many chat requests. You can send 20 messages per minute. Please try again in a minute.";

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const forwardedIp = forwarded?.split(",")[0]?.trim();

  return (
    forwardedIp ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "127.0.0.1"
  );
}

function applyRateLimit(request: Request, limiter: RateLimiter) {
  return new Promise<Response | undefined>((resolve, reject) => {
    const ip = clientIp(request);
    const headers = new Headers();
    let statusCode = 429;
    let settled = false;

    const finish = (response?: Response) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(response);
    };

    const req = { ip, method: request.method, url: request.url };
    const res: MockResponse = {
      headersSent: false,
      writableEnded: false,
      statusCode,
      setHeader(name, value) {
        headers.set(name, String(value));
        return this;
      },
      status(code) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      send(body) {
        this.headersSent = true;
        this.writableEnded = true;
        if (body && typeof body === "object") {
          finish(Response.json(body, { status: statusCode, headers }));
          return this;
        }
        finish(
          new Response(typeof body === "string" ? body : String(body ?? ""), {
            status: statusCode,
            headers,
          }),
        );
        return this;
      },
    };

    const next = (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      finish();
    };

    void Promise.resolve(
      limiter(
        req as unknown as Parameters<RateLimiter>[0],
        res as unknown as Parameters<RateLimiter>[1],
        next,
      ),
    ).catch(reject);
  });
}

function createLimiter(limit: number, message: string) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: "draft-6",
    legacyHeaders: false,
    validate: false,
    statusCode: 429,
    message: { error: message },
    keyGenerator: (req) => ipKeyGenerator(String(req.ip || "127.0.0.1"), 56),
  });
}

const globalForRateLimit = globalThis as typeof globalThis & {
  extractRateLimiter?: RateLimiter;
  chatRateLimiter?: RateLimiter;
};

function getExtractLimiter() {
  globalForRateLimit.extractRateLimiter ??= createLimiter(
    2,
    EXTRACT_LIMIT_MESSAGE,
  );
  return globalForRateLimit.extractRateLimiter;
}

function getChatLimiter() {
  globalForRateLimit.chatRateLimiter ??= createLimiter(20, CHAT_LIMIT_MESSAGE);
  return globalForRateLimit.chatRateLimiter;
}

export async function enforceExtractRateLimit(request: Request) {
  return applyRateLimit(request, getExtractLimiter());
}

export async function enforceChatRateLimit(request: Request) {
  return applyRateLimit(request, getChatLimiter());
}
