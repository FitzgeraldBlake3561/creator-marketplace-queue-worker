import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError, infrai } from "./infrai_queue.js";
import {
  consumeMarketplaceBatch,
  marketplaceJobSchema
} from "./marketplace_worker.js";

const publishBodySchema = z.object({ job: marketplaceJobSchema });
const port = Number(process.env.PORT ?? 3000);

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/orders/publish") {
    json(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const { job } = publishBodySchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    await infrai.queue.publish(job, `marketplace-order-${job.orderId}`);
    json(response, 202, { orderId: job.orderId, state: "queued" });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      json(response, 400, { error: "Invalid marketplace job" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      json(response, error.status, { error: error.code });
      return;
    }
    json(response, 500, { error: "Could not publish order" });
  }
});

server.listen(port, () => {
  console.log(`Marketplace publisher listening on http://localhost:${port}`);
});

let stopping = false;
async function poll(): Promise<void> {
  while (!stopping) {
    const count = await consumeMarketplaceBatch({
      concurrency: 4,
      jobsPerSecond: 2,
      visibilityTimeout: 60,
      onDecision: async (decision) => console.log(JSON.stringify(decision))
    });
    if (count === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

process.on("SIGINT", () => {
  stopping = true;
  server.close();
});

void poll().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
  server.close();
});
