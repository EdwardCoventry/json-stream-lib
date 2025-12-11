import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  runRawJsonStream,
  type RawJsonStreamEvent,
} from "../streaming/raw-json/index.js";

const payload = {
  title: "Valid json but totally meaningless data payload",
  description:
    "This payload is structurally valid JSON but the data is just made up nonsense devoid of meaning.",
  rgb: { red: "#ff0000", green: "#00ff00", blue: "#0000ff" },
  bw: { black: "#000000", white: "#ffffff" },
  items_in_json: 16,
  negative_integer: -17,
  floating_point: 3.14159,
  large_number: 1.2e30,
  small_number: 5.67e-25,
  empty_array: [],
  non_empty_array: ["item_one", 102, { nested: "item_3" }],
  empty_object: {},
  deeper_object: {
    level_1: {
      level_2: {
        level_3: {
          key: "deep_value",
        },
      },
    },
  },
  is_valid_json: true,
  is_sensible_data: false,
  meaning: null,
};

type CompleteEvent = Extract<RawJsonStreamEvent, { type: "complete" }>;
type ValueEvent = Extract<RawJsonStreamEvent, { type: "partial" | "complete" }>;

function collectUniqueSnapshots(events: ValueEvent[]): any[] {
  const snapshots: any[] = [];
  let lastSerialized = "";
  for (const ev of events) {
    if (ev.data.index !== 0) continue; // only care about first JSON document in stream
    const snap = JSON.parse(JSON.stringify(ev.data.value));
    const serialized = JSON.stringify(snap);
    if (serialized === lastSerialized) continue;
    lastSerialized = serialized;
    snapshots.push(snap);
  }
  return snapshots;
}

function isSubset(prev: any, next: any): boolean {
  if (typeof prev !== "object" || prev === null) {
    return Object.is(prev, next);
  }
  if (Array.isArray(prev)) {
    if (!Array.isArray(next)) return false;
    if (prev.length > next.length) return false;
    for (let i = 0; i < prev.length; i++) {
      if (!isSubset(prev[i], next[i])) return false;
    }
    return true;
  }
  if (typeof next !== "object" || next === null || Array.isArray(next)) {
    return false;
  }
  for (const [k, v] of Object.entries(prev)) {
    if (!Object.prototype.hasOwnProperty.call(next, k)) return false;
    if (!isSubset(v, (next as any)[k])) return false;
  }
  return true;
}

function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

function diffAdded(prev: any, next: any): any | undefined {
  // If types differ or prev is undefined/null, treat entire next as added.
  if (prev === undefined) return deepClone(next);
  if (prev === null || next === null) {
    return Object.is(prev, next) ? undefined : deepClone(next);
  }
  const prevIsObj = typeof prev === "object" && !Array.isArray(prev);
  const nextIsObj = typeof next === "object" && !Array.isArray(next);
  const prevIsArr = Array.isArray(prev);
  const nextIsArr = Array.isArray(next);

  if (prevIsArr || nextIsArr) {
    if (!nextIsArr) return deepClone(next);
    const res: any[] = [];
    let hasDiff = false;
    const prevArr = Array.isArray(prev) ? prev : [];
    for (let i = 0; i < next.length; i += 1) {
      const childDiff = diffAdded(prevArr[i], next[i]);
      if (childDiff !== undefined) {
        res[i] = childDiff;
        hasDiff = true;
      }
    }
    return hasDiff ? res : undefined;
  }

  if (!prevIsObj || !nextIsObj) {
    return Object.is(prev, next) ? undefined : deepClone(next);
  }

  const res: Record<string, any> = {};
  let hasDiff = false;
  for (const key of Object.keys(next)) {
    const childDiff = diffAdded(prev[key], next[key]);
    if (childDiff !== undefined) {
      res[key] = childDiff;
      hasDiff = true;
    }
  }
  return hasDiff ? res : undefined;
}

test("runRawJsonStream emits expected events for complex payload", async () => {
  const events: RawJsonStreamEvent[] = [];

  async function* source() {
    const json = JSON.stringify(payload);
    // chunk intentionally at uneven offsets
    yield json.slice(0, 80);
    yield json.slice(80, 180);
    yield json.slice(180, 320);
    yield json.slice(320);
  }

  await runRawJsonStream({
    source: source(),
    emitEmptyContainers: false,
    onEvent: (ev) => events.push(ev),
  });

  const starts = events.filter((e) => e.type === "json-start");
  const partials = events.filter((e) => e.type === "partial");
  const completes = events.filter(
    (e): e is CompleteEvent => e.type === "complete"
  );

  assert.ok(starts.length >= 1, "expected json-start event");
  assert.ok(
    partials.length >= 0,
    "partial events are optional for full-chunk parse"
  );
  assert.equal(completes.length, 1, "expected exactly one complete event");

  const final = completes[0].data;
  assert.deepEqual(final.value, payload);
  assert.equal(final.forcedClosures, 0);

  // Sanity check that the items_in_json count matches the number of top-level keys
  assert.equal(
    Object.keys(final.value).length,
    final.value.items_in_json,
    "items_in_json should equal the number of top-level keys"
  );
});

test("runRawJsonStream incrementally parses incomplete JSON from single-character chunks", async () => {
  const events: RawJsonStreamEvent[] = [];

  async function* source() {
    const json = JSON.stringify(payload);
    // Yield one character at a time to stress the incremental parser.
    for (const ch of json) {
      yield ch;
    }
  }

  await runRawJsonStream({
    source: source(),
    emitEmptyContainers: false,
    onEvent: (ev) => events.push(ev),
  });

  const valueEvents = events.filter(
    (e): e is ValueEvent => e.type === "partial" || e.type === "complete"
  );
  console.log(
    "\n[debug] value events emitted:",
    valueEvents.map((e) => ({
      type: e.type,
      index: e.data.index,
      keys:
        typeof e.data.value === "object" && e.data.value !== null
          ? Object.keys(e.data.value)
          : null,
    }))
  );
  assert.ok(
    valueEvents.length > 0,
    "expected at least one partial/complete event"
  );

  const snapshots = collectUniqueSnapshots(valueEvents);
  assert.ok(snapshots.length >= 2, "expected multiple progressive snapshots");
  console.log("[debug] snapshot count:", snapshots.length);
  console.log(
    "[debug] snapshot keys:",
    snapshots.map((s) => Object.keys(s))
  );

  // First useful snapshot: only the title field should be present.
  assert.deepEqual(snapshots[0], { title: payload.title });

  // Second snapshot: title + description, and nothing else yet.
  assert.deepEqual(snapshots[1], {
    title: payload.title,
    description: payload.description,
  });
  assert.deepEqual(
    Object.keys(snapshots[1]).sort(),
    ["title", "description"].sort()
  );

  // Final snapshot should be the full payload (comes from the 'complete' event).
  const finalSnapshot = snapshots[snapshots.length - 1];
  assert.deepEqual(finalSnapshot, payload);

  // Sanity check that the items_in_json count matches the number of top-level keys
  assert.equal(
    Object.keys(finalSnapshot).length,
    finalSnapshot.items_in_json,
    "items_in_json should equal the number of top-level keys"
  );

  // Every subsequent snapshot should be a monotonic extension of the previous one:
  // keys never disappear or change value, only new keys/structure are added.
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const next = snapshots[i];
    const ok = isSubset(prev, next);
    console.log("[debug] subset check", { step: i, ok });
    assert.ok(ok, `snapshot ${i} should extend snapshot ${i - 1}`);
  }

  // Sanity checks that nested structures eventually appear as expected.
  assert.ok(
    snapshots.some(
      (s) =>
        s.rgb &&
        s.rgb.red === payload.rgb.red &&
        s.rgb.green === payload.rgb.green &&
        s.rgb.blue === payload.rgb.blue
    ),
    "expected full rgb object to appear in some snapshot"
  );

  assert.ok(
    snapshots.some(
      (s) =>
        s.bw &&
        s.bw.black === payload.bw.black &&
        s.bw.white === payload.bw.white
    ),
    "expected full bw object to appear in some snapshot"
  );

  assert.ok(
    snapshots.some(
      (s) =>
        Array.isArray(s.non_empty_array) &&
        s.non_empty_array.length === payload.non_empty_array.length &&
        s.non_empty_array.every(
          (item: any, idx: number) =>
            JSON.stringify(item) ===
            JSON.stringify(payload.non_empty_array[idx])
        )
    ),
    "expected full non_empty_array to appear in some snapshot"
  );

  assert.ok(
    snapshots.some(
      (s) =>
        s.deeper_object &&
        s.deeper_object.level_1 &&
        s.deeper_object.level_1.level_2 &&
        s.deeper_object.level_1.level_2.level_3 &&
        s.deeper_object.level_1.level_2.level_3.key ===
          payload.deeper_object.level_1.level_2.level_3.key
    ),
    "expected deeper_object to appear in some snapshot"
  );
});

test("runRawJsonStream logs progressive diffs for the complex payload", async () => {
  const events: RawJsonStreamEvent[] = [];
  let totalBytes = 0;
  let lastChunkBytes = 0;
  let lastEmittedSnapshot: any = undefined;

  async function* source() {
    const json = JSON.stringify(payload);
    for (const ch of json) {
      lastChunkBytes = 1;
      totalBytes += 1;
      yield ch;
    }
  }

  await runRawJsonStream({
    source: source(),
    emitEmptyContainers: true,
    onEvent: (ev) => {
      events.push(ev);
      if (ev.type !== "partial" && ev.type !== "complete") return;
      if (ev.data.index !== 0) return;
      const status = ev.type === "complete" ? "COMPLETED" : "PARTIAL";
      const snapshot = deepClone(ev.data.value);
      const attempt = "✅";
      const added = diffAdded(lastEmittedSnapshot, snapshot);
      if (added === undefined || (typeof added === "object" && Object.keys(added).length === 0)) {
        return;
      }
      lastEmittedSnapshot = snapshot;
      const logPayload = {
        attempt,
        status,
        forcedClosures: ev.data.forcedClosures,
        bytes: lastChunkBytes,
        totalBytes,
        requestId: "full-payload-verbose",
        added: added ?? {},
      };
      console.log("[debug] [json-stream:full-payload:verbose] parsed:new", JSON.stringify(logPayload, null, 2));
    },
  });

  const completes = events.filter(
    (e): e is CompleteEvent => e.type === "complete"
  );
  assert.equal(completes.length, 1, "should complete the document");
  assert.deepEqual(completes[0].data.value, payload);
});
