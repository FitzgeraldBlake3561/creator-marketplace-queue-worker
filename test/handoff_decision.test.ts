import assert from "node:assert/strict";
import test from "node:test";
import { decideOrderHandoff, marketplaceJobSchema } from "../src/marketplace_worker.js";

test("holds an approved order until every seller asset is ready", () => {
  const job = marketplaceJobSchema.parse({
    orderId: "order-7",
    sellerId: "seller-ink",
    buyerId: "buyer-cut",
    assets: [
      { assetId: "master-video", kind: "video", status: "ready" },
      { assetId: "cover-art", kind: "image", status: "processing" }
    ],
    buyerUpdate: { revision: 3, approval: "approved" }
  });

  assert.deepEqual(decideOrderHandoff(job), {
    orderId: "order-7",
    state: "awaiting_assets",
    readyAssetIds: ["master-video"],
    buyerRevision: 3
  });
});
