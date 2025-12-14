export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      cards: {
        Row: {
          card_name: string
          card_number: string | null
          card_set: string | null
          collection_name: string | null
          condition: string | null
          created_at: string
          current_price_psa10: number | null
          current_price_psa9: number | null
          current_price_raw: number | null
          ebay_listing_id: string | null
          ebay_listing_url: string | null
          edition: string | null
          external_id: string | null
          external_source: string | null
          game_type: string | null
          id: string
          image_error: string | null
          image_last_attempt_at: string | null
          image_status: string | null
          image_url: string
          last_price_update: string | null
          manufacturer: string | null
          normalization_confidence: number | null
          normalization_notes: Json | null
          normalized_at: string | null
          notes: string | null
          ocr_confidence: number | null
          ocr_raw_text: string | null
          player_name: string | null
          rarity: string | null
          raw_manufacturer: string | null
          raw_name: string | null
          raw_number: string | null
          raw_set: string | null
          raw_year: string | null
          set_name: string | null
          sport: string | null
          sport_type: string | null
          suggested_price: number | null
          tags: string[] | null
          team: string | null
          thumbnail_url: string | null
          updated_at: string
          user_id: string
          variant: string | null
          year: number | null
        }
        Insert: {
          card_name: string
          card_number?: string | null
          card_set?: string | null
          collection_name?: string | null
          condition?: string | null
          created_at?: string
          current_price_psa10?: number | null
          current_price_psa9?: number | null
          current_price_raw?: number | null
          ebay_listing_id?: string | null
          ebay_listing_url?: string | null
          edition?: string | null
          external_id?: string | null
          external_source?: string | null
          game_type?: string | null
          id?: string
          image_error?: string | null
          image_last_attempt_at?: string | null
          image_status?: string | null
          image_url: string
          last_price_update?: string | null
          manufacturer?: string | null
          normalization_confidence?: number | null
          normalization_notes?: Json | null
          normalized_at?: string | null
          notes?: string | null
          ocr_confidence?: number | null
          ocr_raw_text?: string | null
          player_name?: string | null
          rarity?: string | null
          raw_manufacturer?: string | null
          raw_name?: string | null
          raw_number?: string | null
          raw_set?: string | null
          raw_year?: string | null
          set_name?: string | null
          sport?: string | null
          sport_type?: string | null
          suggested_price?: number | null
          tags?: string[] | null
          team?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
          variant?: string | null
          year?: number | null
        }
        Update: {
          card_name?: string
          card_number?: string | null
          card_set?: string | null
          collection_name?: string | null
          condition?: string | null
          created_at?: string
          current_price_psa10?: number | null
          current_price_psa9?: number | null
          current_price_raw?: number | null
          ebay_listing_id?: string | null
          ebay_listing_url?: string | null
          edition?: string | null
          external_id?: string | null
          external_source?: string | null
          game_type?: string | null
          id?: string
          image_error?: string | null
          image_last_attempt_at?: string | null
          image_status?: string | null
          image_url?: string
          last_price_update?: string | null
          manufacturer?: string | null
          normalization_confidence?: number | null
          normalization_notes?: Json | null
          normalized_at?: string | null
          notes?: string | null
          ocr_confidence?: number | null
          ocr_raw_text?: string | null
          player_name?: string | null
          rarity?: string | null
          raw_manufacturer?: string | null
          raw_name?: string | null
          raw_number?: string | null
          raw_set?: string | null
          raw_year?: string | null
          set_name?: string | null
          sport?: string | null
          sport_type?: string | null
          suggested_price?: number | null
          tags?: string[] | null
          team?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
          variant?: string | null
          year?: number | null
        }
        Relationships: []
      }
      graded_pricing_cache: {
        Row: {
          cache_key: string
          card_identifier: Json
          created_at: string
          expires_at: string
          grade: string | null
          grader: string | null
          id: string
          response_data: Json
        }
        Insert: {
          cache_key: string
          card_identifier: Json
          created_at?: string
          expires_at: string
          grade?: string | null
          grader?: string | null
          id?: string
          response_data: Json
        }
        Update: {
          cache_key?: string
          card_identifier?: Json
          created_at?: string
          expires_at?: string
          grade?: string | null
          grader?: string | null
          id?: string
          response_data?: Json
        }
        Relationships: []
      }
      grader_premiums: {
        Row: {
          created_at: string
          grade: string
          grader: string
          id: string
          notes: string | null
          premium_multiplier: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          grade: string
          grader: string
          id?: string
          notes?: string | null
          premium_multiplier?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          grade?: string
          grader?: string
          id?: string
          notes?: string | null
          premium_multiplier?: number
          updated_at?: string
        }
        Relationships: []
      }
      n8n_webhook_logs: {
        Row: {
          created_at: string
          id: string
          payload: Json | null
          status: string
          user_id: string
          webhook_id: string | null
          workflow_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json | null
          status?: string
          user_id: string
          webhook_id?: string | null
          workflow_type: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json | null
          status?: string
          user_id?: string
          webhook_id?: string | null
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "n8n_webhook_logs_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "n8n_webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      n8n_webhooks: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
          updated_at: string
          user_id: string
          webhook_name: string | null
          webhook_url: string
          workflow_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          updated_at?: string
          user_id: string
          webhook_name?: string | null
          webhook_url: string
          workflow_type: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          updated_at?: string
          user_id?: string
          webhook_name?: string | null
          webhook_url?: string
          workflow_type?: string
        }
        Relationships: []
      }
      price_alerts: {
        Row: {
          alert_type: string
          card_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          percentage_value: number | null
          threshold_value: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          alert_type: string
          card_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          percentage_value?: number | null
          threshold_value?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          alert_type?: string
          card_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          percentage_value?: number | null
          threshold_value?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_alerts_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history: {
        Row: {
          card_id: string
          id: string
          price_psa10: number | null
          price_psa9: number | null
          price_raw: number | null
          recorded_at: string
          source: string
        }
        Insert: {
          card_id: string
          id?: string
          price_psa10?: number | null
          price_psa9?: number | null
          price_raw?: number | null
          recorded_at?: string
          source: string
        }
        Update: {
          card_id?: string
          id?: string
          price_psa10?: number | null
          price_psa9?: number | null
          price_raw?: number | null
          recorded_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_history_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      remote_scan_sessions: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          last_active_at: string | null
          phone_connected_at: string | null
          session_code: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_active_at?: string | null
          phone_connected_at?: string | null
          session_code: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_active_at?: string | null
          phone_connected_at?: string | null
          session_code?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_filters: {
        Row: {
          created_at: string | null
          filter_config: Json
          filter_name: string
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          filter_config: Json
          filter_name: string
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          filter_config?: Json
          filter_name?: string
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scan_sessions: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          session_name: string | null
          total_cards: number | null
          total_value: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          session_name?: string | null
          total_cards?: number | null
          total_value?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          session_name?: string | null
          total_cards?: number | null
          total_value?: number | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
