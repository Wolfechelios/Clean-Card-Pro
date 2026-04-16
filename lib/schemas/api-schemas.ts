import { z } from "zod";

// ============= Card Pricing Schemas =============

export const CardPricingSchema = z.object({
  raw: z.number().nullable(),
  psa9: z.number().nullable(),
  psa10: z.number().nullable(),
  cgc9: z.number().nullable(),
  cgc10: z.number().nullable(),
  suggested: z.number().nullable(),
  highestSold: z.number().nullable().optional(),
  medianRaw: z.number().nullable(),
  medianPsa9: z.number().nullable(),
  medianPsa10: z.number().nullable(),
  medianCgc9: z.number().nullable(),
  medianCgc10: z.number().nullable(),
  ebayRaw: z.number().nullable(),
  ebayPsa9: z.number().nullable(),
  ebayPsa10: z.number().nullable(),
  ebayCgc9: z.number().nullable(),
  ebayCgc10: z.number().nullable(),
  ebayUrl: z.string().nullable(),
  tcgPlayerPrice: z.number().nullable(),
  tcgPlayerLow: z.number().nullable(),
  tcgPlayerMid: z.number().nullable(),
  tcgPlayerHigh: z.number().nullable(),
  tcgPlayerMarket: z.number().nullable(),
  tcgPlayerUrl: z.string().nullable(),
  source: z.string(),
});

export type CardPricing = z.infer<typeof CardPricingSchema>;

// ============= Card Identification Schemas =============

export const CardAlternativeSchema = z.object({
  card_name: z.string(),
  card_set: z.string().nullable().optional(),
  confidence: z.union([z.string(), z.number()]),
  reason: z.string().optional(),
});

export const PrimaryCardDataSchema = z.object({
  card_name: z.string(),
  card_set: z.string().nullable().optional(),
  card_number: z.string().nullable().optional(),
  rarity: z.string().nullable().optional(),
  edition: z.string().nullable().optional(),
  game_type: z.string().nullable().optional(),
  sport_type: z.string().nullable().optional(),
  year: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  confidence: z.union([z.string(), z.number()]),
  description: z.string().optional(),
});

export const EnhancedCardIdentifyResponseSchema = z.object({
  success: z.boolean(),
  cardData: z.object({
    primary: PrimaryCardDataSchema,
    alternatives: z.array(CardAlternativeSchema).optional(),
  }).optional(),
  rawResponse: z.string().optional(),
  error: z.string().optional(),
  noCardDetected: z.boolean().optional(),
});

export type EnhancedCardIdentifyResponse = z.infer<typeof EnhancedCardIdentifyResponseSchema>;
export type EnhancedCardData = z.infer<typeof PrimaryCardDataSchema>;

// ============= Analyze Card Full Schemas =============

export const DefectLevelSchema = z.enum(["none", "minor", "moderate", "severe"]);

export const DefectFlagsSchema = z.object({
  centering: DefectLevelSchema,
  corners: DefectLevelSchema,
  edges: DefectLevelSchema,
  surface: DefectLevelSchema,
  structural_damage: DefectLevelSchema,
});

export const GradeEstimateSchema = z.object({
  min: z.number(),
  max: z.number(),
  confidence: z.number(),
});

export const LabelSchema = z.object({
  description: z.string(),
  score: z.number(),
  topicality: z.number(),
});

export const AnalyzeCardFullResponseSchema = z.object({
  success: z.boolean(),
  image_url: z.string(),
  card_id: z.string().nullable(),
  game: z.string().nullable(),
  set_code: z.string().nullable(),
  card_name: z.string().nullable(),
  vision: z.object({
    ocr_text: z.string(),
    ocr_locale: z.string().nullable(),
    crop_hint: z.unknown().nullable(),
    image_properties: z.unknown().nullable(),
    labels: z.array(LabelSchema),
    logos: z.array(z.unknown()),
    web_detection: z.object({
      entities: z.array(z.unknown()),
      similar_images: z.array(z.unknown()),
      matching_images: z.array(z.unknown()),
    }),
    raw_vision_response: z.unknown().nullable(),
  }),
  card_details: z.object({
    card_name: z.string().optional(),
    set: z.string().optional(),
    card_number: z.string().optional(),
    rarity: z.string().optional(),
    game_type: z.string().optional(),
  }),
  condition_estimate: z.object({
    card_id: z.string().nullable(),
    game: z.string().nullable(),
    set_code: z.string().nullable(),
    card_name: z.string().nullable(),
    raw_grade_estimate: GradeEstimateSchema,
    condition_notes: z.array(z.string()),
    defect_flags: DefectFlagsSchema,
    recommended_action: z.string(),
    analyzed_at: z.string(),
  }),
  error: z.string().optional(),
  details: z.string().optional(),
});

export type AnalyzeCardFullResponse = z.infer<typeof AnalyzeCardFullResponseSchema>;

// ============= API Error Schema =============

export const ApiErrorSchema = z.object({
  error: z.string(),
  details: z.string().optional(),
  success: z.literal(false).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
