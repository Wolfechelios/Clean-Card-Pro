import assert from "node:assert/strict";
import test from "node:test";

import { parseYugiohOcrText } from "../src/lib/cardOcrParser.ts";
import {
  listYugiohSets,
  rankResolverCandidates,
  yugiohResolver,
} from "../src/lib/resolvers/yugiohResolver.ts";
import { lookupYugiohByPrintedCode } from "../src/lib/yugiohDirectLookup.ts";
import { normalizeYugiohPrintedCode } from "../src/lib/yugiohSetCodeIndex.ts";

test("exact printed code wins and can correct a selected set", () => {
  const result = rankResolverCandidates(
    { printedCode: "SDY-046", selectedSetId: "LOB" },
    [
      { printedCode: "LOB-005", setId: "LOB", cardName: "Wrong" },
      { printedCode: "SDY-046", setId: "SDY", cardName: "Dark Magician" },
    ],
  );

  assert.equal(result.match.cardName, "Dark Magician");
  assert.equal(result.selectedSetCorrected, true);
  assert.equal(result.confidence, 0.98);
});

test("selected set is preferred when OCR has no exact printed code", () => {
  const result = rankResolverCandidates(
    { printedCode: null, selectedSetId: "LOB" },
    [
      {
        printedCode: "SDY-046",
        setId: "SDY",
        cardName: "Higher confidence",
        confidence: 0.95,
      },
      {
        printedCode: "LOB-005",
        setId: "LOB",
        cardName: "Selected set",
        confidence: 0.7,
      },
    ],
  );

  assert.equal(result.match.cardName, "Selected set");
  assert.equal(result.selectedSetCorrected, false);
});

test("parser and lookup share canonical printed-code normalization", () => {
  assert.equal(normalizeYugiohPrintedCode("sdy046"), "SDY-046");
  assert.equal(normalizeYugiohPrintedCode("SDY–EN046"), "SDY-EN046");
  assert.equal(parseYugiohOcrText("Dark Magician\nsdy046").setCode, "SDY-046");
  assert.equal(parseYugiohOcrText("Dark Magician\nSDY EN046").setCode, "SDY-EN046");
});

test("YGOPRODeck fallback supplies identity and images, never pricing", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        data: [
          {
            name: "Dark Magician",
            card_sets: [
              {
                set_code: "SDY-046",
                set_name: "Starter Deck: Yugi",
                set_rarity: "Ultra Rare",
                set_price: "999.99",
              },
            ],
            card_images: [
              {
                image_url: "https://images.example/card.jpg",
                image_url_small: "https://images.example/card-small.jpg",
              },
            ],
            card_prices: [{ tcgplayer_price: "123.45" }],
          },
        ],
      };
    },
  });

  try {
    const result = await lookupYugiohByPrintedCode("sdy046");
    assert.equal(result.cardData.card_name, "Dark Magician");
    assert.equal(result.cardData.image_url, "https://images.example/card.jpg");
    assert.equal(result.pricing, null);
    assert.equal(result.priceChartingUrl, null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("live resolver keeps exact-code and full selected-set identity policies", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = {};
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/data/yugioh-setcode-index.json")) {
      return {
        ok: true,
        async json() {
          return [
            {
              cardName: "Dark Magician",
              setName: "Legend of Blue Eyes",
              setCode: "LOB-005",
            },
            {
              cardName: "Shared Card",
              setName: "Alpha Set",
              setCode: "DUP-001",
            },
            {
              cardName: "Shared Card",
              setName: "Beta Set",
              setCode: "DUP-002",
            },
          ];
        },
      };
    }
    if (url.includes("db.ygoprodeck.com") && url.includes("SDY-046")) {
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                name: "Dark Magician",
                card_sets: [
                  {
                    set_code: "SDY-046",
                    set_name: "Starter Deck: Yugi",
                    set_rarity: "Ultra Rare",
                  },
                ],
                card_images: [],
                card_prices: [{ tcgplayer_price: "42.00" }],
              },
            ],
          };
        },
      };
    }
    return { ok: false, async json() { return {}; } };
  };

  const request = ({
    rawText,
    setCode,
    selectedSetId,
    selectedSetName,
  }) => ({
    session: {
      id: "resolver-integration",
      game: "yugioh",
      selectedSetId,
      selectedSetName,
      profileId: "standard",
      captureMode: "manual",
    },
    ocr: {
      rawText,
      title: rawText.split("\n")[0],
      setCode,
      fullCode: setCode,
      confidence: 0.9,
      source: "local-browser-ocr",
    },
  });

  try {
    await t.test("exact fallback replaces a fuzzy local code mismatch", async () => {
      const result = await yugiohResolver.resolve(
        request({
          rawText: "Dark Magician\nSDY-046",
          setCode: "SDY-046",
          selectedSetId: "LOB::Legend%20of%20Blue%20Eyes",
          selectedSetName: "Legend of Blue Eyes",
        }),
      );

      assert.equal(result.status, "identified");
      assert.equal(result.identity.printedCode, "SDY-046");
      assert.equal(result.identity.cardName, "Dark Magician");
      assert.equal(result.selectedSetCorrected, true);
      assert.deepEqual(result.evidence, [
        "exact-printed-code:SDY-046",
        "ygoprodeck-identity-fallback",
      ]);
      assert.equal("pricing" in result, false);
    });

    await t.test("fuzzy local identity is rejected when exact fallback fails", async () => {
      const result = await yugiohResolver.resolve(
        request({
          rawText: "Dark Magician\nZZZ-999",
          setCode: "ZZZ-999",
          selectedSetId: "LOB::Legend%20of%20Blue%20Eyes",
          selectedSetName: "Legend of Blue Eyes",
        }),
      );

      assert.deepEqual(result, {
        status: "identification_error",
        reason: "No Yu-Gi-Oh identity matched the captured card.",
      });
    });

    await t.test("selected set wins in the live index and keeps its full ID", async () => {
      const result = await yugiohResolver.resolve(
        request({
          rawText: "Shared Card",
          setCode: undefined,
          selectedSetId: "DUP::Beta%20Set",
          selectedSetName: "Beta Set",
        }),
      );

      assert.equal(result.status, "identified");
      assert.equal(result.identity.printedCode, "DUP-002");
      assert.equal(result.identity.setId, "DUP::Beta%20Set");
      assert.equal(result.selectedSetCorrected, false);
    });

    await t.test("exact code corrects an ambiguous-prefix full set ID", async () => {
      const result = await yugiohResolver.resolve(
        request({
          rawText: "Shared Card\nDUP-001",
          setCode: "DUP-001",
          selectedSetId: "DUP::Beta%20Set",
          selectedSetName: "Beta Set",
        }),
      );

      assert.equal(result.status, "identified");
      assert.equal(result.identity.printedCode, "DUP-001");
      assert.equal(result.identity.setId, "DUP::Alpha%20Set");
      assert.equal(result.selectedSetCorrected, true);
    });

    await t.test("listSets exposes full offline catalog IDs", async () => {
      const sets = await listYugiohSets();
      assert.ok(sets.length > 100);
      assert.ok(sets.every((set) => set.id.includes("::")));
      const prefixCounts = new Map();
      for (const set of sets) {
        const prefix = set.id.split("::", 1)[0];
        prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
      }
      assert.ok([...prefixCounts.values()].some((count) => count > 1));
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
