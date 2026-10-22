# ksl-tender-events

KSL tender event writer and daily report section for LAX job
`ec7b155a-6357-450a-95ee-01de6180fcfa` (SEAT7, 40 USDC).

Pure: no RPC, no clock, no keys, no network. Event kinds are `listing`,
`airlock`, `bid`, `selection`, `award`, `delivery`, `review`, `payment`. The
writer validates each event and appends exactly one JSON line to an append only
JSONL stream. `reportSection(events, day)` produces a Markdown report section for
one UTC day, counts each step (one per tender per step), and lists anomalies
with their reasons and timestamps.

## Interface

```js
import { createLog } from "ksl-tender-events/log";
import { reportSection } from "ksl-tender-events";

const log = createLog({ path: "./tender.jsonl" }); // or memory only
log.emit({ kind: "listing", tender_id: "t1", at: "2026-10-22T08:00:00Z" });
log.emit({ kind: "airlock", tender_id: "t1", at: "2026-10-22T08:01:00Z" });

const md = reportSection(log.all(), "2026-10-22");
// Markdown table of counts plus "No anomalies." or "Anomalies (n): - ..."
```

## Rules

- Append only JSONL: `emit` validates and appends one line; reloading keeps all events and appending does not truncate.
- Validation: unknown kinds and malformed UTC instants are refused; required fields `kind`, `tender_id`, `at` must be non empty strings.
- Counts: one count per tender per step per day.
- Anomalies (over the full stream, reported for the day): `bid without airlock` (bid before airlock on the same tender); `payment without acceptance` (payment with no award and no review on the same tender); `payment without review` (payment after award but before review). Prerequisites are checked on the same tender id across days.
- House rules clean: Latin digits only, no long dashes, no secrets, small single concern files.

## Tests

```
node --test test/*.test.mjs
```

Seven tests, each named after an acceptance item: append only and validated; unknown kind or bad timestamp refused; report counts each step; bid without airlock decision listed; payment without acceptance listed; report scoped to one day; JSONL file append only and reloads. Node 20 or later.
