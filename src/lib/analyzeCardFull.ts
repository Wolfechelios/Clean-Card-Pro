// src/lib/analyzeCardFull.ts

export type FullCardAnalysis = {
  image_url: string;
  card_id: string | null;
  game: string | null;
  set_code: string | null;
  card_name: string | null;
  vision: {
    ocr_text: string;
    ocr_locale: string | null;
    crop_hint: {
      importanceFraction: number | null;
      boundingPoly: any;
    } | null;
    image_properties: any;
    raw_vision_response: any;
  };
  condition_estimate: {
    card_id: string | null;
    game: string | null;
    set_code: string | null;
    card_name: string | null;
    raw_grade_estimate: { min: number; max: number; confidence: number };
    condition_notes: string[];
    defect_flags: {
      centering: string;
      corners: string;
      edges: string;
      surface: string;
      structural_damage: string;
    };
    recommended_action: string;
    analyzed_at: string;
  };
};

export async function analyzeCardFull(
  imageUrl: string,
  opts?: {
    cardId?: string;
    game?: string;
    setCode?: string;
    cardName?: string;
  }
): Promise<FullCardAnalysis> {
  const res = await fetch("/functions/v1/analyze-card-full", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      card_id: opts?.cardId,
      game: opts?.game,
      set_code: opts?.setCode,
      card_name: opts?.cardName,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`analyze-card-full failed: ${res.status} – ${text}`);
  }

  return (await res.json()) as FullCardAnalysis;
}
