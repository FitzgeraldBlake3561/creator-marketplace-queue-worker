import { infrai } from "../src/infrai_queue.js";
import { marketplaceJobSchema } from "../src/marketplace_worker.js";

const job = marketplaceJobSchema.parse({
  orderId: "order-1042",
  sellerId: "studio-river",
  buyerId: "channel-north",
  assets: [
    { assetId: "trailer-4k", kind: "video", status: "ready" },
    { assetId: "cover-square", kind: "image", status: "ready" }
  ],
  buyerUpdate: { revision: 2, approval: "approved" }
});

await infrai.queue.publish(job, `marketplace-order-${job.orderId}`);
console.log(JSON.stringify({ orderId: job.orderId, state: "queued" }));
