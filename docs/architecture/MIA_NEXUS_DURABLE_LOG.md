# MIA NEXUS N2: durable event log (transactional outbox)

Status: implemented for **one** low-risk research topic, `ditas.outcome.recorded.v1`. Every other topic keeps its N1 status ([catalog](MIA_NEXUS_EVENT_CATALOG.md)). No order, fill, ledger, risk or wallet path emits fabric events, and nothing here can place, size or approve a trade.

## What it does

1. **Same-transaction append.** `ditas/service.ts#addOutcome` writes the `ditas_outcomes` row and calls `fabric/outbox.ts#appendEvent` inside one `tx()`. If either write fails, both roll back. `appendEvent` refuses to run outside a transaction, refuses topics that are not `OUTBOX_DURABLE`, and validates the `fabric.event.v1` envelope (owner, hash, timestamps, no secret keys) before storing it.
2. **Append-only log.** Migration **v10** adds `fabric_outbox` and `fabric_inbox`. Triggers abort any change to the stored envelope (id, type, producer, trace, envelope, hash, recorded time) and any `DELETE`. Only delivery bookkeeping (`status`, `attempts`, `deliver_after`, `last_error`, `delivered_at`) can change.
3. **Relay.** `fabric/relay.ts#relayOnce` runs in the engine leader's background pass (`bot/bot.ts`), after the leadership check. It:
   - reads due `PENDING` rows in `seq` order and fully re-validates each stored envelope: JSON, schema, owner and payload hash, and that it matches its row. An invalid one is dead-lettered, never delivered, and does not block the rows behind it;
   - marks an event with no subscribed consumer `NO_CONSUMER`, not `DELIVERED`, because nobody received it;
   - runs each subscribed consumer's handler and its `fabric_inbox` row in **one** transaction, so a crash before the status update leads to a redelivery that the inbox skips (effect happens once);
   - on failure, backs off `min(5 min, 1 s × 2^(attempts−1))`. While an earlier event of the same topic is still `PENDING` for a consumer, later ones wait, across passes (no overtaking);
   - after `maxAttempts` (default 8) marks the row `DEAD`, writes `fabric.dead_letter` to the audit chain and sends an owner notification. Dead letters are not retried or deleted automatically. A dead event releases the queue for later events, so the gap is recorded rather than silent. A future financial topic may need a stricter halt-on-dead rule.
4. **Health.** `GET /api/fabric/outbox` (owner session) returns measured counts, oldest pending age, the latest 50 dead letters and registered consumers.

## Delivery guarantee

At-least-once delivery from the outbox; exactly-once *effect* per consumer through the inbox. No consumer is registered in production yet, so today a committed event becomes `NO_CONSUMER` on the next leader pass. A consumer registered later does not see older events, because no replay tool exists yet. Consumers must be read-model builders: the relay module imports only the DB helpers, the audit chain and notifications (enforced by `test/fabric-contracts.test.ts`).

## Naming note

`telegram_outbox` (migration v8) is a separate Telegram message queue. It is not part of the fabric and is unchanged.

## Data and provenance

The DITAS outcome event payload carries ids, the 0/1 outcome, the observed price and time, and `provenance: OWNER_REPORTED_UNVERIFIED`. The envelope is marked `dataStatus: UNVERIFIED`. Free-text source references are **not** copied into the event. `traceId` is the original DITAS decision event; `snapshotId` is that event's content-addressed snapshot when it has one.

## Tests

`server/test/fabric-outbox.test.ts` covers:
- rollback leaves no event;
- append outside a transaction is refused;
- disabled topics and tampered envelopes are refused;
- duplicate ids are refused;
- the immutability and no-delete triggers;
- atomic outcome + event with lineage, and paper orders/fills/ledger unchanged;
- rollback of the outcome when the outbox write fails;
- ordered single delivery, crash redelivery dedup, handler rollback and backoff;
- no overtaking after a failure, including a pass made during the backoff;
- a dead event releasing the queue;
- `NO_CONSUMER` marking;
- invalid JSON, a hash mismatch, and an id mismatch in stored envelopes;
- dead-letter with audit and notification;
- health counts and route auth.

Mutation checks each make a test fail: removing the inbox check, the transaction guard, or the cross-pass ordering guard.

## Not done (next phases)

- No other topic is durable yet. Order, fill and ledger events need a separate reviewed phase with the trading-risk reviewer.
- No production consumers, retention/archival job, or dead-letter replay tool.
- Bot Account shows outbox counts, oldest pending age and registered consumer count from the owner-authenticated health endpoint. Dead letters remain API evidence.
