// Event vocabulary for the KSL tender stream (LAX seat ec7b155a, SEAT7).
// Small single concern file: only the kinds and the step order rules.

export const EVENT_KINDS = [
  "listing",
  "airlock",
  "bid",
  "selection",
  "award",
  "delivery",
  "review",
  "payment",
];

// The happy path step order. An anomaly is a kind that appears before its
// prerequisite, which the report must surface, never silently accept.
export const STEP_ORDER = EVENT_KINDS.reduce((acc, k, i) => {
  acc[k] = i;
  return acc;
}, {});

// Which step must exist before this one, on the same tender (by tender_id).
// No prerequisite means the kind may open a tender.
export const REQUIRES = {
  listing: null,
  airlock: "listing",
  bid: "airlock",
  selection: "bid",
  award: "selection",
  delivery: "award",
  review: "delivery",
  payment: "review",
};

export function kindIndex(kind) {
  return Object.prototype.hasOwnProperty.call(STEP_ORDER, kind) ? STEP_ORDER[kind] : -1;
}
