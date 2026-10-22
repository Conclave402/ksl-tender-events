// Tests for the KSL tender event stream and daily report (LAX seat ec7b155a).
// Each test is named after an acceptance item and fails without the change.
// node:test, no network, no key, no clock.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLog, validateEvent, EventError } from "../src/log.mjs";
import { reportSection, findAnomalies } from "../src/report.mjs";
import { EVENT_KINDS } from "../src/events.mjs";

const T1 = "tender-a";
const T2 = "tender-b";
const DAY = "2026-10-22";

function ev(kind, tender_id, at, extra = {}) {
  return { kind, tender_id, at, ...extra };
}

test("A1 events are append only and validated", () => {
  const log = createLog();
  const a = log.emit(ev("listing", T1, `${DAY}T08:00:00Z`));
  assert.equal(a.kind, "listing");
  assert.ok(Object.isFrozen(a), "a stored event is frozen, so it cannot be mutated in place");
  log.emit(ev("airlock", T1, `${DAY}T08:01:00Z`, { decision: "pass" }));
  assert.equal(log.all().length, 2);
  // A missing required field is refused and nothing is appended.
  assert.throws(() => log.emit({ kind: "bid", tender_id: T1 }), EventError);
  assert.equal(log.all().length, 2);
});

test("A2 an unknown kind or bad timestamp is refused", () => {
  assert.throws(() => validateEvent(ev("nonsense", T1, `${DAY}T08:00:00Z`)), EventError);
  assert.throws(() => validateEvent(ev("listing", T1, "2026-10-22 08:00")), EventError);
  assert.throws(() => validateEvent(ev("listing", "", `${DAY}T08:00:00Z`)), EventError);
  // Every declared kind validates.
  for (const k of EVENT_KINDS) {
    assert.equal(validateEvent(ev(k, T1, `${DAY}T08:00:00Z`)).kind, k);
  }
});

test("A3 the report counts each step for the day", () => {
  const events = [
    ev("listing", T1, `${DAY}T08:00:00Z`),
    ev("airlock", T1, `${DAY}T08:01:00Z`),
    ev("bid", T1, `${DAY}T09:00:00Z`),
    ev("bid", T1, `${DAY}T10:00:00Z`), // second bid on same tender counts once
    ev("selection", T1, `${DAY}T11:00:00Z`),
    ev("award", T1, `${DAY}T12:00:00Z`),
    ev("delivery", T1, `${DAY}T13:00:00Z`),
    ev("review", T1, `${DAY}T14:00:00Z`),
    ev("payment", T1, `${DAY}T15:00:00Z`),
  ];
  const md = reportSection(events, DAY);
  assert.match(md, /\| listing \| 1 \|/);
  assert.match(md, /\| bid \| 1 \|/);
  assert.match(md, /\| payment \| 1 \|/);
  assert.match(md, /9 events on 1 tenders\./);
});

test("A4 the report lists a bid without an airlock decision", () => {
  const events = [
    ev("listing", T1, `${DAY}T08:00:00Z`),
    ev("bid", T1, `${DAY}T09:00:00Z`), // no airlock before it
  ];
  const md = reportSection(events, DAY);
  assert.match(md, /bid without airlock/);
  const a = findAnomalies(events);
  assert.equal(a.length, 1);
  assert.equal(a[0].reason, "bid without airlock");
});

test("A5 the report lists a payment without acceptance", () => {
  const events = [
    ev("listing", T1, `${DAY}T08:00:00Z`),
    ev("airlock", T1, `${DAY}T08:01:00Z`),
    ev("bid", T1, `${DAY}T09:00:00Z`),
    ev("selection", T1, `${DAY}T10:00:00Z`),
    ev("payment", T1, `${DAY}T12:00:00Z`), // no award, no review: no acceptance
  ];
  const md = reportSection(events, DAY);
  assert.match(md, /payment without acceptance/);
  // A payment after an award (acceptance) but before review is a strict order
  // warning, not the no-acceptance case.
  const afterAward = [
    ev("listing", T2, `${DAY}T08:00:00Z`),
    ev("airlock", T2, `${DAY}T08:01:00Z`),
    ev("bid", T2, `${DAY}T09:00:00Z`),
    ev("selection", T2, `${DAY}T10:00:00Z`),
    ev("award", T2, `${DAY}T11:00:00Z`),
    ev("payment", T2, `${DAY}T12:00:00Z`),
  ];
  assert.equal(findAnomalies(afterAward).filter((a) => a.kind === "payment").length, 1);
  assert.match(reportSection(afterAward, DAY), /payment without review/);
  // A well formed tender has no anomalies.
  const clean = [
    ev("listing", T2, `${DAY}T08:00:00Z`),
    ev("airlock", T2, `${DAY}T08:01:00Z`),
    ev("bid", T2, `${DAY}T09:00:00Z`),
    ev("selection", T2, `${DAY}T10:00:00Z`),
    ev("award", T2, `${DAY}T11:00:00Z`),
    ev("delivery", T2, `${DAY}T12:00:00Z`),
    ev("review", T2, `${DAY}T13:00:00Z`),
    ev("payment", T2, `${DAY}T14:00:00Z`),
  ];
  assert.equal(findAnomalies(clean).length, 0);
});

test("A6 the report is scoped to one day", () => {
  const events = [
    ev("listing", T1, `${DAY}T08:00:00Z`),
    ev("airlock", T1, "2026-10-23T08:00:00Z"),
    ev("bid", T1, "2026-10-23T09:00:00Z"),
  ];
  const md22 = reportSection(events, DAY);
  assert.match(md22, /1 events on 1 tenders\./);
  assert.match(md22, /\| bid \| 0 \|/);
  const md23 = reportSection(events, "2026-10-23");
  assert.match(md23, /2 events on 1 tenders\./);
  assert.match(md23, /\| bid \| 1 \|/);
  assert.doesNotMatch(md23, /without/); // airlock is present in the full stream
});

test("A7 the JSONL file is append only and reloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "ksl-"));
  const path = join(dir, "tender.jsonl");
  try {
    const log = createLog({ path });
    log.emit(ev("listing", T1, `${DAY}T08:00:00Z`));
    log.emit(ev("airlock", T1, `${DAY}T08:01:00Z`));
    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(lines.length, 2, "one event per line, nothing rewritten");
    // Reload sees both events; append does not truncate.
    const reopened = createLog({ path });
    assert.equal(reopened.all().length, 2);
    reopened.emit(ev("bid", T1, `${DAY}T09:00:00Z`));
    assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
