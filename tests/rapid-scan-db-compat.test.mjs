import assert from "node:assert/strict";
import test from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
const storage = new Map();
globalThis.localStorage = {
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  removeItem: (key) => storage.delete(key),
  setItem: (key, value) => storage.set(key, String(value)),
};

const { enqueueCapture, rapidScanDb } = await import("../src/lib/rapidScan/db.ts");

function job(overrides = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    idempotencyKey: overrides.idempotencyKey ?? id,
    createdAt: 100,
    updatedAt: 100,
    rotation: 0,
    status: "captured",
    retryCount: 0,
    session: {
      id: "session",
      game: "other",
      selectedSetId: null,
      selectedSetName: null,
      profileId: "standard",
      captureMode: "auto",
    },
    originalBlob: new Blob(["original"], { type: "image/jpeg" }),
    mime: "image/jpeg",
    ...overrides,
  };
}

function card(id, overrides = {}) {
  return {
    id,
    fingerprint: `legacy:${id}`,
    quantity: 1,
    card_name: "Card",
    card_set: "Set",
    card_number: "1",
    game_type: "other",
    rarity: null,
    image_url: null,
    pricing_status: "pending",
    current_price_raw: null,
    current_price_psa9: null,
    current_price_psa10: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function reset() {
  await rapidScanDb.transaction(
    "rw",
    rapidScanDb.captureJobs,
    rapidScanDb.inventoryCards,
    rapidScanDb.scanEvents,
    rapidScanDb.migrationReceipts,
    async () => Promise.all([
      rapidScanDb.captureJobs.clear(),
      rapidScanDb.inventoryCards.clear(),
      rapidScanDb.scanEvents.clear(),
      rapidScanDb.migrationReceipts.clear(),
    ]),
  );
  localStorage.clear();
}

async function legacyQueue(items) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("card_scout_pro");
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("legacy queue delete blocked"));
  });
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("card_scout_pro", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("rapid_scan_queue", { keyPath: "id" });
      store.createIndex("status_createdAt", ["status", "createdAt"]);
      store.createIndex("createdAt", "createdAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = database.transaction("rapid_scan_queue", "readwrite");
    items.forEach((item) => tx.objectStore("rapid_scan_queue").put(item));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  database.close();
}

async function legacyCards(rows) {
  const { default: localforage } = await import("localforage");
  const store = localforage.createInstance({ name: "card-scout", storeName: "cards" });
  await store.clear();
  for (const [key, value] of rows) await store.setItem(key, value);
}

test("enqueue preserves existing primary and idempotency identities", async () => {
  await reset();
  await enqueueCapture(job({ id: "same", status: "processing_ocr", processingStartedAt: 500 }));
  await enqueueCapture(job({ id: "same", originalBlob: new Blob(["replacement"]) }));
  await enqueueCapture(job({ id: "other", idempotencyKey: "same" }));
  const stored = await rapidScanDb.captureJobs.get("same");
  assert.equal(stored.status, "processing_ocr");
  assert.equal(await stored.originalBlob.text(), "original");
  assert.equal(await rapidScanDb.captureJobs.count(), 1);
});

test("queue migration preserves existing v2 work", async () => {
  await reset();
  await rapidScanDb.captureJobs.add(job({ id: "existing", status: "processing_ocr" }));
  await legacyQueue([
    { id: "existing", createdAt: 1, status: "queued", blob: new Blob(["old"]), mime: "image/jpeg", filename: "old.jpg" },
    { id: "new", createdAt: 2, status: "queued", blob: new Blob(["new"]), mime: "image/jpeg", filename: "new.jpg" },
  ]);
  const queue = await import("../src/lib/idbQueue.ts?base=1");
  await queue.idbCount();
  assert.equal((await rapidScanDb.captureJobs.get("existing")).status, "processing_ocr");
});

test("identified work remains pending until saved", async () => {
  await reset();
  localStorage.setItem("rapid_scan_v2_queue_migrated", "1");
  const queue = await import("../src/lib/idbQueue.ts?pending=1");
  await rapidScanDb.captureJobs.add(job({ id: "captured", status: "captured" }));
  await rapidScanDb.captureJobs.add(job({ id: "processing", status: "processing_ocr" }));
  await rapidScanDb.captureJobs.add(job({ id: "identified", status: "identified" }));
  assert.equal(await queue.idbCountPending(), 3);
});

test("legacy cards migrate before reads with full field fidelity", async () => {
  await reset();
  await legacyCards([["legacy", {
    ...card("legacy"),
    collection_name: "Legacy Set",
    normalization_notes: { source: "legacy" },
    notes: "keep",
    tags: ["foil"],
    user_id: "legacy-user",
  }]]);
  const cards = await import("../src/lib/localCards.ts?base=1");
  const migrated = (await cards.getAllCards())[0];
  assert.equal(migrated.collection_name, "Legacy Set");
  assert.deepEqual(migrated.normalization_notes, { source: "legacy" });
  assert.deepEqual(migrated.tags, ["foil"]);
  assert.equal(migrated.user_id, "legacy-user");
});

test("consumed queue jobs stay consumed across marker loss and concurrent replay", async () => {
  await reset();
  await legacyQueue([{ id: "consumed", createdAt: 3, status: "queued", blob: new Blob(["once"]), mime: "image/jpeg", filename: "once.jpg" }]);
  const first = await import("../src/lib/idbQueue.ts?consume=1");
  await first.idbGet("consumed");
  await first.idbDelete("consumed");
  localStorage.removeItem("rapid_scan_v2_queue_migrated");
  const [a, b] = await Promise.all([
    import("../src/lib/idbQueue.ts?consume=2a"),
    import("../src/lib/idbQueue.ts?consume=2b"),
  ]);
  await Promise.all([a.idbCount(), b.idbCount()]);
  assert.equal(await rapidScanDb.captureJobs.get("consumed"), undefined);
});

test("deleted and cleared legacy cards stay deleted across replay", async () => {
  await reset();
  await legacyCards([["deleted", card("deleted")], ["cleared", card("cleared")]]);
  const first = await import("../src/lib/localCards.ts?delete=1");
  await first.getAllCards();
  await first.deleteCardLocal("deleted");
  await first.clearAllLocalCards();
  localStorage.removeItem("rapid_scan_v2_cards_migrated");
  const replay = await import("../src/lib/localCards.ts?delete=2");
  await replay.getAllCards();
  assert.equal(await rapidScanDb.inventoryCards.count(), 0);
});

test("pre-ledger queue marker backfills receipts without restoring work", async () => {
  await reset();
  await legacyQueue([{ id: "old-consumed", createdAt: 4, status: "queued", blob: new Blob(["old"]), mime: "image/jpeg", filename: "old.jpg" }]);
  localStorage.setItem("rapid_scan_v2_queue_migrated", "1");
  const backfill = await import("../src/lib/idbQueue.ts?prequeue=1");
  assert.equal(await backfill.idbCount(), 0);
  localStorage.removeItem("rapid_scan_v2_queue_migrated");
  await (await import("../src/lib/idbQueue.ts?prequeue=2")).idbCount();
  assert.equal(await rapidScanDb.captureJobs.get("old-consumed"), undefined);
});

test("pre-ledger card marker backfills receipts without restoring cards", async () => {
  await reset();
  await legacyCards([["old-deleted", card("old-deleted")]]);
  localStorage.setItem("rapid_scan_v2_cards_migrated", "1");
  const backfill = await import("../src/lib/localCards.ts?precard=1");
  assert.equal((await backfill.getAllCards()).length, 0);
  localStorage.removeItem("rapid_scan_v2_cards_migrated");
  await (await import("../src/lib/localCards.ts?precard=2")).getAllCards();
  assert.equal(await rapidScanDb.inventoryCards.get("old-deleted"), undefined);
});
