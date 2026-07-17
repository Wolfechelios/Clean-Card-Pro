  logTrace(item.id, "ocr-result", {
    durationMs: ocrDurationMs,
    data: {
      title: ocr?.title,
      setCode: ocr?.setCode,
      cardNumber: ocr?.cardNumber,
      fullCode: ocr?.fullCode,
      game: ocr?.game,
      confidence: ocr?.confidence,
      rawText: ocr?.rawText ? ocr.rawText.slice(0, 600) : "",
    },
  });

  const hasStructured = Boolean(ocr?.title || ocr?.setCode || ocr?.cardNumber || ocr?.fullCode);
  if (!ocrText && !hasStructured) {
    pipelineTracer.record({ itemId: item.id, stage: "identify", status: "skip", error: "unreadable OCR" });
    await markQueueItemError(item.id, "Unreadable scan — retake photo");
    return;
  }

  const printedIdentifier = firstValidPrintedIdentifier(ocr?.setCode, ocr?.fullCode, ocr?.cardNumber);
  const hasValidTitle = isReadableTitle(ocr?.title);
  if (!printedIdentifier) {
    pipelineTracer.record({ itemId: item.id, stage: "identify", status: "skip", error: "no printed code" });
    await markQueueItemError(item.id, "No printed set/card code found — retake photo closer to the code");
    return;
  }

  logTrace(item.id, "lookup-start", { data: { setCode: printedIdentifier, cardNumber: ocr?.cardNumber ?? null, game: ocr?.game ?? null } });
  const endIdentify = pipelineTracer.begin(item.id, "identify");
  const lookupStartedAt = performance.now();
  let lookup: Awaited<ReturnType<typeof runRapidBasicLookup>>;
  try {
    lookup = await withTimeout(
      runRapidBasicLookup({
        imageUrl: null,
        ocrText,
        title: hasValidTitle ? ocr?.title ?? null : null,
        setName: null,
        setCode: printedIdentifier,
        cardNumber: ocr?.cardNumber ?? null,
        edition: ocr?.edition ?? null,
        game: ocr?.game ?? null,
        gameTypeHint,
        allowGoogleLens: false,
      }),
      LOCAL_LOOKUP_TIMEOUT_MS,
      "Printed-code card lookup",
    );
  } catch (e: any) {
    endIdentify({ status: /timeout/i.test(e?.message || "") ? "timeout" : "fail", error: e?.message || String(e) });
    throw e;
  }
  const lookupDurationMs = Math.round(performance.now() - lookupStartedAt);

  const identify = lookup.cardData;
  const pricing = lookup.pricing ?? null;
  endIdentify({
    status: lookup.success && identify?.card_name ? "ok" : "fail",
    error: lookup.error || undefined,
    meta: { source: (lookup as any).source ?? null, cardName: identify?.card_name ?? null },
  });
  pipelineTracer.record({
    itemId: item.id,
    stage: "price",
    status: hasReadablePrice(pricing) ? "ok" : "skip",
    meta: { raw: pricing?.raw ?? null, psa10: pricing?.psa10 ?? null, source: (lookup as any).source ?? null },
  });
  logTrace(item.id, "lookup-result", {
    durationMs: lookupDurationMs,
    data: {
      success: lookup.success,
      source: (lookup as any).source ?? null,
      cardName: identify?.card_name ?? null,
      error: lookup.error ?? null,
      hasPrice: hasReadablePrice(pricing),
    },
  });

  if (!lookup.success || !identify?.card_name) {
    await markQueueItemError(item.id, lookup.error || "No printed-code lookup match — retake photo closer to the printed code");
    return;
  }

  const cardName = String(identify.card_name || "").trim();
  const confidence = Number(identify.confidence ?? 0.98);
  const cardSet = identify.card_set ?? null;
  const cardNumber = identify.card_number ?? ocr?.cardNumber ?? ocr?.setCode ?? null;
  const rarity = identify.rarity ?? null;
  const gameType = identify.game_type ?? null;
  const sportType = identify.sport_type ?? null;
  const year = identify.year ?? null;
  const manufacturer = identify.manufacturer ?? null;
  const playerName = sportType ? cardName : null;
  const team = null;
  const imageUrl = base64;
  const rawPrice = money(pricing?.raw ?? pricing?.highestSold ?? null);
  const psa10Price = money(pricing?.psa10 ?? pricing?.cgc10 ?? null);

  const processedCard: ProcessedCard = {
    id: item.id,
    cardName,
    cardSet: cardSet || undefined,
    cardNumber: cardNumber || undefined,
    rarity: rarity || undefined,
    gameType: gameType || undefined,
    sportType: sportType || undefined,
    value: rawPrice,
    psa10Price,
    imageUrl,
    isInLibrary: false,
    libraryQuantity: 0,
    year: year || undefined,
    playerName: playerName || undefined,
    team: team || undefined,
    manufacturer: manufacturer || undefined,
  };

  const confPct = confidence * 100;
  const threshold = scanSettings.autoConfirmThreshold ?? 75;

  if (scanSettings.scanMode === "SAVE" && confPct >= threshold) {
    const endSave = pipelineTracer.begin(item.id, "save");
    try {
      const inserted = await insertCardDual({
        user_id: userId,
        card_name: cardName,
        card_set: cardSet,
        card_number: cardNumber,
        rarity,
        game_type: gameType,
        sport_type: sportType,
        image_url: imageUrl,
        image_source: "scan",
        image_status: "local-preview",
        image_search_status: "found",
        current_price_raw: rawPrice,
        suggested_price: rawPrice,
        last_price_update: rawPrice ? new Date().toISOString() : null,
        condition: "ungraded",
        year: year ? parseInt(year, 10) || null : null,
        player_name: playerName,
        team,
        manufacturer,
        raw_name: cardName,
        raw_set: cardSet,
        raw_number: cardNumber,
        raw_year: year,
        raw_manufacturer: manufacturer,
        ocr_confidence: confidence,
      } as any);
      processedCard.isInLibrary = true;
      processedCard.dbId = inserted.id;
      processedCard.libraryQuantity = 1;
      endSave({ status: "ok", meta: { dbId: inserted.id } });
    } catch (e: any) {
      console.error("[QueueProcessor] auto-save failed:", e);
      endSave({ status: "fail", error: e?.message || String(e) });
    }
  } else {
    pipelineTracer.record({
      itemId: item.id,
      stage: "save",
      status: "skip",
      meta: { reason: scanSettings.scanMode !== "SAVE" ? "scan-mode-not-save" : "below-confidence-threshold", confPct, threshold },
    });
  }

  useQueueProcessor.getState()._setLastProcessedCard(processedCard);
  console.log("[QueueProcessor] Printed-code lookup matched", cardName, { ocrSource: ocr?.source ?? "local-browser-ocr", source: lookup.source, hasPrice: hasReadablePrice(pricing) });

  addRecentScan({
    id: item.id,
    card_name: cardName,
    card_set: cardSet,
    card_number: cardNumber,
    player_name: playerName,
    image_url: imageUrl,
    price: rawPrice,
    psa10Price,
    confidence,
    rarity,
    gameType,
    sportType,
    dbId: processedCard.dbId ?? null,
    isInLibrary: processedCard.isInLibrary,
    libraryQuantity: processedCard.libraryQuantity,
    year,
    team,
    manufacturer,
  });

  logTrace(item.id, "success", {
    message: cardName,
    data: { cardName, cardSet, cardNumber, value: rawPrice, source: (lookup as any).source ?? null },
  });
  window.dispatchEvent(new CustomEvent("recent-scan-added"));
  await idbDelete(item.id);
}

export async function checkAndResumeQueue(): Promise<void> {
  if (autoResumeChecked) return;
  autoResumeChecked = true;
  const state = useQueueProcessor.getState();
  const anomalyPaused = state.isPausedByAnomaly || readAnomalyPauseFlag();
  if (anomalyPaused) {
    useQueueProcessor.setState({ isPaused: true, isPausedByAnomaly: true });
    return;
  }
  const queuedCount = await idbCountQueued();
  if (queuedCount > 0) state.start();
}

export { idbAdd, idbCount, idbCountQueued, idbClear, idbGetAll, idbDelete } from "@/lib/idbQueue";
