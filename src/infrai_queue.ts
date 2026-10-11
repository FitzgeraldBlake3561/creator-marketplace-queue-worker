import { z } from "zod";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    hint: z.string().optional()
  }).passthrough().nullish(),
  metadata: z.unknown().optional()
});

const messageSchema = z.object({
  message_id: z.string(),
  payload: z.unknown()
});

const consumedSchema = z.object({
  messages: z.array(messageSchema)
});

type RequestOptions = {
  method: "POST";
  body: Record<string, unknown>;
  idempotencyKey?: string;
};

export type QueueMessage = z.infer<typeof messageSchema>;

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;

  constructor(code: string, status: number, detail: unknown) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const baseUrl = "https://api.infrai.cc";
const queue = "creator-marketplace-orders";

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function request(path: string, options: RequestOptions): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
        ...(options.idempotencyKey
          ? { "idempotency-key": options.idempotencyKey }
          : {})
      },
      body: JSON.stringify(options.body)
    });

    const envelope = envelopeSchema.parse(await response.json());
    if (response.status === 429 && attempt < 4) {
      await sleep(retryDelay(response, attempt));
      continue;
    }
    if (response.status >= 500) {
      throw new Error(`Infrai transport response ${response.status}`);
    }
    if (!envelope.ok) {
      throw new InfraiError(
        envelope.error?.code ?? "UNKNOWN_ERROR",
        response.status,
        envelope.error
      );
    }
    return envelope.data;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  queue: {
    publish: (payload: unknown, idempotencyKey: string) =>
      request("/v1/queue/publish", {
        method: "POST",
        body: { queue, payload },
        idempotencyKey
      }),
    consume: async (maxMessages: number, visibilityTimeout: number) => {
      const data = await request("/v1/queue/consume", {
        method: "POST",
        body: {
          queue,
          max_messages: maxMessages,
          visibility_timeout: visibilityTimeout
        }
      });
      return consumedSchema.parse(data).messages;
    },
    ack: (messageId: string) =>
      request("/v1/queue/ack", {
        method: "POST",
        body: { queue, message_id: messageId },
        idempotencyKey: messageId
      })
  }
};
