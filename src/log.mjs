// Append only JSONL writer for KSL tender events. No engine changes, no network.
// emit(event) validates one event and appends exactly one JSON line.

import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { EVENT_KINDS, kindIndex } from "./events.mjs";

const REQUIRED_FIELDS = ["kind", "tender_id", "at"];

export class EventError extends Error {
  constructor(message) {
    super(message);
    this.name = "EventError";
  }
}

// Validate one event. Returns a frozen normalised copy or throws EventError.
export function validateEvent(event) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    throw new EventError("event must be an object");
  }
  for (const f of REQUIRED_FIELDS) {
    if (typeof event[f] !== "string" || event[f].length === 0) {
      throw new EventError(`event.${f} must be a non empty string`);
    }
  }
  if (kindIndex(event.kind) < 0) {
    throw new EventError(`unknown event kind: ${event.kind}`);
  }
  // ISO 8601 UTC instant, so the daily report can bucket by day without a clock.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(event.at)) {
    throw new EventError("event.at must be an ISO 8601 UTC instant like 2026-10-22T20:00:00Z");
  }
  return Object.freeze({ ...event });
}

// An in memory, append only log. `path` is a JSONL file; if omitted the log is
// memory only, which the tests use. emit returns the normalised event.
export function createLog({ path = null } = {}) {
  const events = [];
  if (path && existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (t) events.push(JSON.parse(t));
    }
  }
  function emit(event) {
    const normalised = validateEvent(event);
    events.push(normalised);
    if (path) appendFileSync(path, JSON.stringify(normalised) + "\n");
    return normalised;
  }
  function all() {
    return events.slice();
  }
  return { emit, all };
}
