import { z } from "zod";
import { infrai, type QueueMessage } from "./infrai_queue.js";

export const marketplaceJobSchema = z.object({
  orderId: z.string().min(1),
  sellerId: z.string().min(1),
  buyerId: z.string().min(1),
  assets: z.array(z.object({
    assetId: z.string().min(1),
    kind: z.enum(["video", "audio", "image"]),
    status: z.enum(["ready", "processing"])
  })).min(1),
  buyerUpdate: z.object({
    revision: z.number().int().nonnegative(),
    approval: z.enum(["approved", "changes_requested"])
  })
});

export type MarketplaceJob = z.infer<typeof marketplaceJobSchema>;

export type HandoffDecision = {
  orderId: string;
  state: "handed_off" | "awaiting_assets" | "awaiting_approval";
  readyAssetIds: string[];
  buyerRevision: number;
};

export function decideOrderHandoff(job: MarketplaceJob): HandoffDecision {
  const readyAssetIds = job.assets
    .filter((asset) => asset.status === "ready")
    .map((asset) => asset.assetId);
  const allAssetsReady = readyAssetIds.length === job.assets.length;

  return {
    orderId: job.orderId,
    state: !allAssetsReady
      ? "awaiting_assets"
      : job.buyerUpdate.approval === "approved"
        ? "handed_off"
        : "awaiting_approval",
    readyAssetIds,
    buyerRevision: job.buyerUpdate.revision
  };
}

export type WorkerOptions = {
  concurrency: number;
  jobsPerSecond: number;
  visibilityTimeout: number;
  onDecision: (decision: HandoffDecision) => Promise<void>;
};

async function processMessage(
  message: QueueMessage,
  options: WorkerOptions
): Promise<void> {
  const job = marketplaceJobSchema.parse(message.payload);
  await options.onDecision(decideOrderHandoff(job));
  await infrai.queue.ack(message.message_id);
}

export async function consumeMarketplaceBatch(options: WorkerOptions): Promise<number> {
  const messages = await infrai.queue.consume(
    options.concurrency,
    options.visibilityTimeout
  );
  const interval = 1_000 / options.jobsPerSecond;

  await Promise.all(messages.map(async (message, index) => {
    await new Promise<void>((resolve) => setTimeout(resolve, index * interval));
    await processMessage(message, options);
  }));

  return messages.length;
}
