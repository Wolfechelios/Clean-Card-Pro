import assert from "node:assert/strict";
import test from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const { rapidScanDb } = await import("../src/lib/rapidScan/db.ts");
const {
  buildCardFingerprint,
  planInventoryMutation,
  upsertIdentifiedCapture,
} = await import("../src/lib/rapidScan/inventoryUpsert.ts");

const identity = {
  game: "yugioh",
  cardName: "Dark Magician",
  printedCode: "SDY-006",
  setId: "SDY",
  setName: "Starter Deck: Yugi",
  language: "EN",
  edition: "1st",
  variant: "Ultra Rare",
  confidence: 0.98,
};

function captureJob(id, idempotencyKey) {
  return {
    id,
    idempotencyKey,
    createdAt: 100,
    updatedAt: 100,
    rotation: 0,
    status: "identified",
    retryCount: 0,
    session: {
      id: "session",
      game: "yugioh",
      selectedSetId: "SDY",
      selectedSetName: "Starter Deck: Yugi",
      profileId: "standard",
      captureMode: "manual",
    },
    originalBlob: new Blob(["original"], { type: "image/jpeg" }),
    mime: "image/jpeg",
  };
}

function resolved() {
  return {
    status: "identified",
    identity: { ...identity },
    selectedSetCorrected: false,
    evidence: ["exact-printed-code:SDY-006"],
  };
}

async function reset() {
  await rapidScanDb.transaction(
    "rw",
    rapidScanDb.captureJobs,
    rapidScanDb.inventoryCards,
    rapidScanDb.scanEvents,
    async () => Promise.all([
      rapidScanDb.captureJobs.clear(),
      rapidScanDb.inventoryCards.clear(),
      rapidScanDb.scanEvents.clear(),
    ]),
  );
}

test("fingerprints normalize components and separate ungraded cards from PSA 10", async () => {
  const normalized = await buildCardFingerprint({
    game: " YuGiOh ",
    language: " EN ",
    printedCode: " SDY-006 ",
    edition: " 1ST ",
    variant: " Ultra Rare ",
    gradingCompany: " Ungraded ",
    grade: " Ungraded ",
  });
  const equivalent = await buildCardFingerprint({
    game: "yugioh",
    language: "en",
    printedCode: "sdy-006",
    edition: "1st",
    variant: "ultra rare",
    gradingCompany: "ungraded",
    grade: "ungraded",
  });
  const psa10 = await buildCardFingerprint({
    game: "yugioh",
    language: "en",
    printedCode: "sdy-006",
    edition: "1st",
    variant: "ultra rare",
    gradingCompany: "PSA",
    grade: "10",
  });

  assert.equal(normalized, equivalent);
  assert.match(normalized, /^[a-f0-9]{64}$/);
  assert.notEqual(normalized, psa10);
});

test("omitted and blank raw-grade values use the canonical ungraded sentinel", async () => {
  const base = {
    game: "yugioh",
    language: "en",
    printedCode: "sdy-006",
    edition: "1st",
    variant: "ultra rare",
  };
  const omitted = await buildCardFingerprint(base);
  const nulls = await buildCardFingerprint({
    ...base,
    gradingCompany: null,
    grade: null,
  });
  const blanks = await buildCardFingerprint({
    ...base,
    gradingCompany: " \t ",
    grade: " ",
  });
  const explicit = await buildCardFingerprint({
    ...base,
    gradingCompany: "Ungraded",
    grade: " ungraded ",
  });

  assert.equal(omitted, nulls);
  assert.equal(nulls, blanks);
  assert.equal(blanks, explicit);
});

test("inventory mutation planning increments captures but leaves retries unchanged", () => {
  assert.equal(
    planInventoryMutation({ quantity: 1 }, "new-capture").nextQuantity,
    2,
  );
  assert.equal(
    planInventoryMutation(
      { quantity: 2 },
      "retry-existing-event",
    ).nextQuantity,
    2,
  );
});

test("inventory upsert canonicalizes every raw-grade sentinel spelling", async () => {
  await reset();
  const jobs = Array.from({ length: 4 }, (_, index) =>
    captureJob(`raw-job-${index}`, `raw-capture-${index}`)
  );
  const gradeInputs = [
    {},
    { gradingCompany: null, grade: null },
    { gradingCompany: " \t", grade: " " },
    { gradingCompany: "Ungraded", grade: " ungraded " },
  ];
  await rapidScanDb.captureJobs.bulkAdd(jobs);

  for (let index = 0; index < jobs.length; index += 1) {
    await upsertIdentifiedCapture(jobs[index], resolved(), gradeInputs[index]);
  }

  const cards = await rapidScanDb.inventoryCards.toArray();
  const events = await rapidScanDb.scanEvents.toArray();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].quantity, 4);
  assert.equal(new Set(events.map((event) => event.fingerprint)).size, 1);
  assert.deepEqual(
    new Set(events.map((event) => event.fingerprintSource)),
    new Set([
      "yugioh\u001fen\u001fsdy-006\u001f1st\u001fultra rare\u001fungraded\u001fungraded",
    ]),
  );
});

test("two intentional captures increment once each and retrying either key never increments", async () => {
  await reset();
  const firstJob = captureJob("job-1", "capture-1");
  const secondJob = captureJob("job-2", "capture-2");
  await rapidScanDb.captureJobs.bulkAdd([firstJob, secondJob]);

  const first = await upsertIdentifiedCapture(firstJob, resolved(), {});
  const second = await upsertIdentifiedCapture(secondJob, resolved(), {
    gradingCompany: " ",
    grade: null,
  });
  await upsertIdentifiedCapture(firstJob, resolved(), {});
  await upsertIdentifiedCapture(secondJob, resolved(), {});

  assert.deepEqual(
    { action: first.action, quantity: first.quantity },
    { action: "created", quantity: 1 },
  );
  assert.deepEqual(
    { action: second.action, quantity: second.quantity },
    { action: "incremented", quantity: 2 },
  );
  assert.equal(await rapidScanDb.inventoryCards.count(), 1);
  assert.equal((await rapidScanDb.inventoryCards.toArray())[0].quantity, 2);
  assert.equal(await rapidScanDb.scanEvents.count(), 2);
  assert.equal((await rapidScanDb.captureJobs.get("job-1")).status, "saved");
  assert.equal((await rapidScanDb.captureJobs.get("job-2")).status, "saved");

  const events = await rapidScanDb.scanEvents.orderBy("createdAt").toArray();
  assert.equal(
    events[0].fingerprintSource,
    "yugioh\u001fen\u001fsdy-006\u001f1st\u001fultra rare\u001fungraded\u001fungraded",
  );
  assert.equal(events[0].fingerprint, events[1].fingerprint);
});

test("scan events retain immutable resolver evidence, identity, and capture context", async () => {
  await reset();
  const job = captureJob("audit-job", "audit-capture");
  job.rotation = 270;
  job.session.captureMode = "auto";
  job.session.profileId = "absolute-high-gloss";
  const result = resolved();
  await rapidScanDb.captureJobs.add(job);

  await upsertIdentifiedCapture(job, result, {});
  result.evidence.push("mutated-after-save");
  result.identity.cardName = "Changed";
  job.session.selectedSetName = "Changed";

  const event = await rapidScanDb.scanEvents
    .where("idempotencyKey")
    .equals("audit-capture")
    .first();
  assert.deepEqual(event.evidence, ["exact-printed-code:SDY-006"]);
  assert.deepEqual(event.identity, identity);
  assert.equal(event.confidence, 0.98);
  assert.deepEqual(event.session, {
    id: "session",
    game: "yugioh",
    selectedSetId: "SDY",
    selectedSetName: "Starter Deck: Yugi",
    profileId: "absolute-high-gloss",
    captureMode: "auto",
  });
  assert.equal(event.rotation, 270);
  assert.equal(event.capturedAt, 100);
});

test("concurrent intentional captures serialize without lost increments", async () => {
  await reset();
  const jobs = Array.from({ length: 12 }, (_, index) =>
    captureJob(`concurrent-job-${index}`, `concurrent-capture-${index}`)
  );
  await rapidScanDb.captureJobs.bulkAdd(jobs);

  await Promise.all(
    jobs.map((job) => upsertIdentifiedCapture(job, resolved(), {})),
  );

  const cards = await rapidScanDb.inventoryCards.toArray();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].quantity, jobs.length);
  assert.equal(await rapidScanDb.scanEvents.count(), jobs.length);
  assert.equal(
    await rapidScanDb.captureJobs.where("status").equals("saved").count(),
    jobs.length,
  );
});
