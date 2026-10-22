// Daily report section for the KSL tender stream (LAX seat ec7b155a, SEAT7).
// reportSection(events, day) -> markdown. Pure: counts each step and lists the
// anomalies, in day order, for one UTC day.

import { EVENT_KINDS, REQUIRES } from "./events.mjs";

// An acceptance is an award or a review that can precede a payment. A payment is
// only sound when the tender was accepted first.
const ACCEPTING_KINDS = new Set(["award", "review"]);

function dayOf(iso) {
  return iso.slice(0, 10);
}

// Find anomalies over the whole stream, so a prerequisite that exists on another
// day still counts. Returns an array of {tender_id, kind, at, reason}.
export function findAnomalies(events) {
  const seenByTender = new Map(); // tender_id -> Set(kind)
  const anomalies = [];
  for (const e of events) {
    const seen = seenByTender.get(e.tender_id) ?? new Set();
    const prereq = REQUIRES[e.kind];
    if (e.kind === "payment") {
      // A payment needs an acceptance first: an award (or a review) on the same
      // tender. This is the spec named case, so it reports that exact wording.
      if (![...ACCEPTING_KINDS].some((k) => seen.has(k))) {
        anomalies.push({
          tender_id: e.tender_id,
          kind: e.kind,
          at: e.at,
          reason: "payment without acceptance",
        });
      } else if (!seen.has(prereq)) {
        anomalies.push({
          tender_id: e.tender_id,
          kind: e.kind,
          at: e.at,
          reason: `payment without ${prereq}`,
        });
      }
    } else if (prereq && !seen.has(prereq)) {
      anomalies.push({
        tender_id: e.tender_id,
        kind: e.kind,
        at: e.at,
        reason: `${e.kind} without ${prereq}`,
      });
    }
    seen.add(e.kind);
    seenByTender.set(e.tender_id, seen);
  }
  return anomalies;
}

// Count one kind per tender on the given day, so a repeated bid on one tender
// counts the tender once for that step.
function countsForDay(events, day) {
  const perKind = new Map(EVENT_KINDS.map((k) => [k, new Set()]));
  for (const e of events) {
    if (dayOf(e.at) === day) perKind.get(e.kind).add(e.tender_id);
  }
  const out = {};
  for (const k of EVENT_KINDS) out[k] = perKind.get(k).size;
  return out;
}

export function reportSection(events, day) {
  if (!Array.isArray(events)) throw new TypeError("reportSection: events must be an array");
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new TypeError("reportSection: day must be YYYY-MM-DD");
  }
  const dayEvents = events.filter((e) => dayOf(e.at) === day);
  const counts = countsForDay(events, day);
  // Anomalies must be judged over the whole stream (a prerequisite may fall on
  // an earlier day), then filtered to those that occur on the reported day.
  const anomalies = findAnomalies(events).filter((a) => dayOf(a.at) === day);

  const dayTenders = new Set(dayEvents.map((e) => e.tender_id)).size;
  const lines = [];
  lines.push(`## Tender report ${day}`);
  lines.push("");
  lines.push(`${dayEvents.length} events on ${dayTenders} tenders.`);
  lines.push("");
  lines.push("| step | tenders |");
  lines.push("| --- | --- |");
  for (const k of EVENT_KINDS) lines.push(`| ${k} | ${counts[k]} |`);
  lines.push("");
  if (anomalies.length === 0) {
    lines.push("No anomalies.");
  } else {
    lines.push(`Anomalies (${anomalies.length}):`);
    for (const a of anomalies) {
      lines.push(`- ${a.reason} (tender ${a.tender_id}, at ${a.at})`);
    }
  }
  return lines.join("\n");
}
