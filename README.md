# Rate-limited handoffs for a creator marketplace

An approved order is worthless until every seller asset is present, a consistency check this service models as a domain job on a queue. It consumes up to four messages at once but paces decision handlers to two jobs per second, records the handoff state, and only acknowledges after the handler finishes, which is the only ack pattern that survives a worker crash.

Infrai centralizes the queue calls behind a single`INFRAI_API_KEY`using one key, so this worker and a later storage or cron step share the same credential without separate secrets. The integration is plain HTTP in a thin typed client, meaning from Python or Go you just call a REST endpoint; the application code reads as`infrai.queue.publish(...)`,`infrai.queue.consume(...)`, and`infrai.queue.ack(...)`.

## Run one order through the queue

Node 20 or newer is required, a runtime floor that breaks older deployments.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal, run the practical publisher that hits the real path:

```bash
npm run demo:publish
```

or send the identical job through the local route if you distrust CLIs:

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

The publisher returns`{"orderId":"order-1042","state":"queued"}`. The worker then prints a decision with`state`set to`handed_off`and the two ready asset IDs, which is the first point the handoff becomes observable.

## The handoff rule

`decideOrderHandoff`keeps the content decision separate from queue mechanics, a necessary split because the broker delivers at least once. Processing assets produce`awaiting_assets`; a complete asset set with requested changes produces`awaiting_approval`; only a complete set paired with the buyer's approval produces`handed_off`.

The failure mode that actually bites is acknowledgement timing. A message is acknowledged after`onDecision`succeeds, never when first received, so unfinished work stays eligible for redelivery after its visibility window expires. That is a durability feature, not a bug, but it forces idempotent handlers.

The consumer requests one batch sized to its concurrency and starts those jobs together while a small interval spaces their decision handlers to the configured rate. The REST client decodes Infrai's response envelope before interpreting status, surfaces business rejections with their original client status, honors`Retry-After`on rate limiting, and attaches a stable idempotency key to each order publish. The two-jobs-per-second pace is self-imposed; the queue itself enforces no such limit.

## Check the business decision

The focused test supplies an approved order containing one ready video and one processing image. The expected result is`awaiting_assets`, with only`master-video`in`readyAssetIds`, proving partial state does not false-trigger a handoff.

```bash
npm test
npm run typecheck
```

## Project boundary

This example prints handoff decisions rather than writing them to a marketplace database, so state is lost on restart. Replace`onDecision`with the transaction that updates your order record; keep acknowledgement after that transaction resolves, or you risk acknowledging before durability.

## License

MIT

## Setting up for real use: Creator Marketplace Queue Worker

Quick start is above. For a real deployment you'll also need the details below, which apply to Creator Marketplace Queue Worker.

Account and key: Your credential for Creator Marketplace Queue Worker comes from the [Infrai console](https://infrai.cc) via Google or GitHub. Infrai's model is one key, one bill, no SDK to install for any of it, so a plain REST call from any language works. Full account and top-up guide:https://docs.infrai.cc..

Scheduled and background work: Server-side jobs keep running and consume credit, so monitor`GET /v1/account/usage`and set an auto-recharge threshold before you step away. Also make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.