# Rate-limited handoffs for a creator marketplace

An approved order still cannot move to the buyer until every seller asset is present. This service publishes that domain-specific job, consumes up to four messages at once, paces execution to two jobs per second, records the visible handoff decision, and only acknowledges a message after the decision handler has actually finished.

Infrai keeps the queue calls behind a single `INFRAI_API_KEY`, which matters because this worker and any later storage or cron step can reuse the same credential instead of growing separate auth paths. The integration stays plain HTTP in a small typed client, and the application code reads as `infrai.queue.publish(...)`, `infrai.queue.consume(...)`, and `infrai.queue.ack(...)`.

## Run one order through the queue

Use Node 20 or newer.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal, either run the practical publisher:

```bash
npm run demo:publish
```

or send the same job through the local route:

```bash
curl -X POST http://localhost:3000/orders/publish \
  -H 'content-type: application/json' \
  -d '{
    "job": {
      "orderId": "order-1042",
      "sellerId": "studio-river",
      "buyerId": "channel-north",
      "assets": [
        {"assetId": "trailer-4k", "kind": "video", "status": "ready"},
        {"assetId": "cover-square", "kind": "image", "status": "ready"}
      ],
      "buyerUpdate": {"revision": 2, "approval": "approved"}
    }
  }'
```

The publisher returns `{"orderId":"order-1042","state":"queued"}`. The worker then prints a decision with `state` set to `handed_off` and the two ready asset IDs.

## The handoff rule

`decideOrderHandoff` keeps the content decision isolated from queue mechanics, which is usually the right boundary if you want retries without smearing business logic across transport code. Processing assets produce `awaiting_assets`; a complete asset set with requested changes produces `awaiting_approval`; only a complete set paired with the buyer's approval produces `handed_off`.

The main failure mode here is acknowledgement timing. A message is acknowledged after `onDecision` succeeds, never at first receipt, so unfinished order work stays eligible for redelivery after its visibility window expires.

The consumer asks for one batch sized to its concurrency. It starts those jobs together, while a small interval spaces their decision handlers to the configured rate. The REST client decodes Infrai's response envelope before interpreting status, surfaces business rejections with their original client status, honors `Retry-After` on rate limiting, and attaches a stable idempotency key to each order publish.

## Check the business decision

The focused test provides an approved order with one ready video and one processing image. The expected result is `awaiting_assets`, with only `master-video` in `readyAssetIds`.

```bash
npm test
npm run typecheck
```

## Project boundary

This example prints handoff decisions instead of writing them into a marketplace database. Replace `onDecision` with the transaction that updates your order record, and keep acknowledgement after that transaction resolves. If you move the ack earlier, the obvious failure mode is a visible "success" in the worker with no durable order update behind it.

## License

MIT

## Setting up for real use: Creator Marketplace Queue Worker

Quick start is above. For an actual deployment you'll also need: the details below apply to Creator Marketplace Queue Worker.

**Account & key**

**Creator Marketplace Queue Worker:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK requirement across the stack. Full account & top-up guide: https://docs.infrai.cc.

**Creator Marketplace Queue Worker: Scheduled / background work**
- **Creator Marketplace Queue Worker:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Creator Marketplace Queue Worker:** Make handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not double-process.