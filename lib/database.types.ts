/**
 * Hand-written Supabase Database type matching supabase/migrations/*.sql.
 * Regenerate with `supabase gen types typescript --linked > lib/database.types.ts` after Phase 2.
 *
 * Shape follows what `supabase gen types` emits so the regenerated file is a drop-in.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          handle: string;
          avatar_url: string | null;
          push_token: string | null;
          premium_until: string | null;
          quiet_hours_start: number | null;
          quiet_hours_end: number | null;
          age_confirmed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          handle: string;
          avatar_url?: string | null;
          push_token?: string | null;
          premium_until?: string | null;
          quiet_hours_start?: number | null;
          quiet_hours_end?: number | null;
          age_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          handle?: string;
          avatar_url?: string | null;
          push_token?: string | null;
          premium_until?: string | null;
          quiet_hours_start?: number | null;
          quiet_hours_end?: number | null;
          age_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          name: string;
          invite_code: string;
          created_by: string;
          settings: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          invite_code: string;
          created_by: string;
          settings?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          invite_code?: string;
          created_by?: string;
          settings?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rooms_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      room_members: {
        Row: {
          room_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["room_role"];
          joined_at: string;
        };
        Insert: {
          room_id: string;
          user_id: string;
          role?: Database["public"]["Enums"]["room_role"];
          joined_at?: string;
        };
        Update: {
          room_id?: string;
          user_id?: string;
          role?: Database["public"]["Enums"]["room_role"];
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_members_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "room_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      slates: {
        Row: {
          id: string;
          room_id: string;
          slate_date: string;
          status: Database["public"]["Enums"]["slate_status"];
          created_at: string;
          finalized_at: string | null;
        };
        Insert: {
          id?: string;
          room_id: string;
          slate_date: string;
          status?: Database["public"]["Enums"]["slate_status"];
          created_at?: string;
          finalized_at?: string | null;
        };
        Update: {
          id?: string;
          room_id?: string;
          slate_date?: string;
          status?: Database["public"]["Enums"]["slate_status"];
          created_at?: string;
          finalized_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "slates_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      slips: {
        Row: {
          id: string;
          user_id: string;
          room_id: string;
          slate_id: string;
          book: Database["public"]["Enums"]["sportsbook"];
          bet_type: Database["public"]["Enums"]["bet_type"];
          stake: number;
          odds_american: number;
          potential_payout: number;
          status: Database["public"]["Enums"]["slip_status"];
          legs_total: number;
          legs_remaining: number;
          screenshot_path: string | null;
          parsed_json: Json | null;
          parse_confidence: number | null;
          created_at: string;
          updated_at: string;
          settled_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          room_id: string;
          slate_id: string;
          book: Database["public"]["Enums"]["sportsbook"];
          bet_type: Database["public"]["Enums"]["bet_type"];
          stake: number;
          odds_american: number;
          potential_payout: number;
          status?: Database["public"]["Enums"]["slip_status"];
          legs_total?: number;
          legs_remaining?: number;
          screenshot_path?: string | null;
          parsed_json?: Json | null;
          parse_confidence?: number | null;
          created_at?: string;
          updated_at?: string;
          settled_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          room_id?: string;
          slate_id?: string;
          book?: Database["public"]["Enums"]["sportsbook"];
          bet_type?: Database["public"]["Enums"]["bet_type"];
          stake?: number;
          odds_american?: number;
          potential_payout?: number;
          status?: Database["public"]["Enums"]["slip_status"];
          legs_total?: number;
          legs_remaining?: number;
          screenshot_path?: string | null;
          parsed_json?: Json | null;
          parse_confidence?: number | null;
          created_at?: string;
          updated_at?: string;
          settled_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "slips_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "slips_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "slips_slate_id_fkey";
            columns: ["slate_id"];
            isOneToOne: false;
            referencedRelation: "slates";
            referencedColumns: ["id"];
          },
        ];
      };
      legs: {
        Row: {
          id: string;
          slip_id: string;
          room_id: string;
          sport: Database["public"]["Enums"]["sport"];
          market: Database["public"]["Enums"]["market"];
          selection: string;
          line: number | null;
          player_name: string | null;
          stat_type: string | null;
          teams: string[] | null;
          leg_odds_american: number | null;
          status: Database["public"]["Enums"]["leg_status"];
          current_value: number | null;
          propfein_event_id: string | null;
          propfein_market_key: string | null;
          propfein_player_id: string | null;
          side: string | null;
          match_confidence: number | null;
          graded_by: Database["public"]["Enums"]["graded_by"] | null;
          graded_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slip_id: string;
          room_id: string;
          sport: Database["public"]["Enums"]["sport"];
          market: Database["public"]["Enums"]["market"];
          selection: string;
          line?: number | null;
          player_name?: string | null;
          stat_type?: string | null;
          teams?: string[] | null;
          leg_odds_american?: number | null;
          status?: Database["public"]["Enums"]["leg_status"];
          current_value?: number | null;
          propfein_event_id?: string | null;
          propfein_market_key?: string | null;
          propfein_player_id?: string | null;
          side?: string | null;
          match_confidence?: number | null;
          graded_by?: Database["public"]["Enums"]["graded_by"] | null;
          graded_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slip_id?: string;
          room_id?: string;
          sport?: Database["public"]["Enums"]["sport"];
          market?: Database["public"]["Enums"]["market"];
          selection?: string;
          line?: number | null;
          player_name?: string | null;
          stat_type?: string | null;
          teams?: string[] | null;
          leg_odds_american?: number | null;
          status?: Database["public"]["Enums"]["leg_status"];
          current_value?: number | null;
          propfein_event_id?: string | null;
          propfein_market_key?: string | null;
          propfein_player_id?: string | null;
          side?: string | null;
          match_confidence?: number | null;
          graded_by?: Database["public"]["Enums"]["graded_by"] | null;
          graded_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "legs_slip_id_fkey";
            columns: ["slip_id"];
            isOneToOne: false;
            referencedRelation: "slips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "legs_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      leg_overrides: {
        Row: {
          id: string;
          leg_id: string;
          room_id: string;
          user_id: string;
          old_status: Database["public"]["Enums"]["leg_status"];
          new_status: Database["public"]["Enums"]["leg_status"];
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          leg_id: string;
          room_id: string;
          user_id: string;
          old_status: Database["public"]["Enums"]["leg_status"];
          new_status: Database["public"]["Enums"]["leg_status"];
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          leg_id?: string;
          room_id?: string;
          user_id?: string;
          old_status?: Database["public"]["Enums"]["leg_status"];
          new_status?: Database["public"]["Enums"]["leg_status"];
          reason?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leg_overrides_leg_id_fkey";
            columns: ["leg_id"];
            isOneToOne: false;
            referencedRelation: "legs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leg_overrides_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leg_overrides_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      parse_corrections: {
        Row: {
          id: string;
          slip_id: string;
          user_id: string;
          field_path: string;
          parsed_value: Json | null;
          corrected_value: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          slip_id: string;
          user_id: string;
          field_path: string;
          parsed_value?: Json | null;
          corrected_value?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          slip_id?: string;
          user_id?: string;
          field_path?: string;
          parsed_value?: Json | null;
          corrected_value?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "parse_corrections_slip_id_fkey";
            columns: ["slip_id"];
            isOneToOne: false;
            referencedRelation: "slips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "parse_corrections_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      room_events: {
        Row: {
          id: number;
          room_id: string;
          slate_id: string | null;
          slip_id: string | null;
          type: Database["public"]["Enums"]["room_event_type"];
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: never;
          room_id: string;
          slate_id?: string | null;
          slip_id?: string | null;
          type: Database["public"]["Enums"]["room_event_type"];
          payload?: Json;
          created_at?: string;
        };
        Update: {
          id?: never;
          room_id?: string;
          slate_id?: string | null;
          slip_id?: string | null;
          type?: Database["public"]["Enums"]["room_event_type"];
          payload?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_events_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "room_events_slate_id_fkey";
            columns: ["slate_id"];
            isOneToOne: false;
            referencedRelation: "slates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "room_events_slip_id_fkey";
            columns: ["slip_id"];
            isOneToOne: false;
            referencedRelation: "slips";
            referencedColumns: ["id"];
          },
        ];
      };
      tails: {
        Row: {
          slip_id: string;
          user_id: string;
          book_clicked: Database["public"]["Enums"]["sportsbook"] | null;
          created_at: string;
        };
        Insert: {
          slip_id: string;
          user_id: string;
          book_clicked?: Database["public"]["Enums"]["sportsbook"] | null;
          created_at?: string;
        };
        Update: {
          slip_id?: string;
          user_id?: string;
          book_clicked?: Database["public"]["Enums"]["sportsbook"] | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tails_slip_id_fkey";
            columns: ["slip_id"];
            isOneToOne: false;
            referencedRelation: "slips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tails_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: number;
          user_id: string;
          room_id: string | null;
          slate_id: string | null;
          slip_id: string | null;
          type: Database["public"]["Enums"]["notification_type"];
          title: string;
          body: string;
          url: string | null;
          sent_at: string | null;
          expo_ticket_id: string | null;
          expo_receipt_status: string | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          user_id: string;
          room_id?: string | null;
          slate_id?: string | null;
          slip_id?: string | null;
          type: Database["public"]["Enums"]["notification_type"];
          title: string;
          body: string;
          url?: string | null;
          sent_at?: string | null;
          expo_ticket_id?: string | null;
          expo_receipt_status?: string | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          user_id?: string;
          room_id?: string | null;
          slate_id?: string | null;
          slip_id?: string | null;
          type?: Database["public"]["Enums"]["notification_type"];
          title?: string;
          body?: string;
          url?: string | null;
          sent_at?: string | null;
          expo_ticket_id?: string | null;
          expo_receipt_status?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_slate_id_fkey";
            columns: ["slate_id"];
            isOneToOne: false;
            referencedRelation: "slates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_slip_id_fkey";
            columns: ["slip_id"];
            isOneToOne: false;
            referencedRelation: "slips";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      /** The caller's own profiles row, every column. `profiles` itself only exposes id/handle/avatar_url/created_at to other users. */
      me: {
        Row: Database["public"]["Tables"]["profiles"]["Row"];
        Relationships: [];
      };
      room_standings: {
        Row: {
          room_id: string | null;
          user_id: string | null;
          handle: string | null;
          avatar_url: string | null;
          settled: number | null;
          won: number | null;
          lost: number | null;
          profit: number | null;
          risked: number | null;
          roi_percent: number | null;
          bad_beats: number | null;
        };
        Relationships: [];
      };
      slate_board: {
        Row: {
          id: string | null;
          user_id: string | null;
          room_id: string | null;
          slate_id: string | null;
          book: Database["public"]["Enums"]["sportsbook"] | null;
          bet_type: Database["public"]["Enums"]["bet_type"] | null;
          stake: number | null;
          odds_american: number | null;
          potential_payout: number | null;
          status: Database["public"]["Enums"]["slip_status"] | null;
          legs_total: number | null;
          legs_remaining: number | null;
          screenshot_path: string | null;
          parsed_json: Json | null;
          parse_confidence: number | null;
          created_at: string | null;
          updated_at: string | null;
          settled_at: string | null;
          handle: string | null;
          avatar_url: string | null;
          status_rank: number | null;
          remaining_rank: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      create_room: {
        Args: { p_name: string };
        Returns: Database["public"]["Tables"]["rooms"]["Row"];
      };
      join_room: {
        Args: { p_invite_code: string };
        Returns: Database["public"]["Tables"]["rooms"]["Row"];
      };
      ensure_slate: {
        Args: { p_room_id: string; p_date?: string };
        Returns: Database["public"]["Tables"]["slates"]["Row"];
      };
      override_leg: {
        Args: {
          p_leg_id: string;
          p_new_status: Database["public"]["Enums"]["leg_status"];
          p_reason?: string | null;
        };
        Returns: Database["public"]["Tables"]["legs"]["Row"];
      };
      is_room_member: {
        Args: { p_room_id: string };
        Returns: boolean;
      };
      /** Service role only. Returns one row (read `rows[0]`) with the before/after pair for transition detection. */
      rollup_slip: {
        Args: { p_slip_id: string };
        Returns: {
          id: string;
          room_id: string;
          slate_id: string;
          user_id: string;
          old_status: Database["public"]["Enums"]["slip_status"];
          new_status: Database["public"]["Enums"]["slip_status"];
          old_legs_remaining: number;
          new_legs_remaining: number;
          legs_total: number;
          potential_payout: number;
          stake: number;
        }[];
      };
    };
    Enums: {
      room_role: "owner" | "member";
      slate_status: "open" | "live" | "final";
      slip_status: "pending" | "live" | "won" | "lost" | "void" | "push";
      leg_status: "pending" | "live" | "won" | "lost" | "void" | "push" | "needs_review";
      bet_type: "single" | "parlay" | "sgp" | "round_robin" | "teaser" | "other";
      sportsbook: "draftkings" | "fanduel" | "caesars" | "betmgm" | "fanatics" | "other";
      market: "spread" | "total" | "moneyline" | "player_prop" | "team_prop" | "other";
      sport: "nfl" | "nba" | "mlb" | "nhl" | "ncaaf" | "ncaab" | "other";
      graded_by: "auto" | "user" | "peer";
      room_event_type:
        | "slip_added"
        | "leg_hit"
        | "leg_lost"
        | "slip_dead"
        | "one_away"
        | "cashed"
        | "tailed"
        | "slate_final";
      notification_type:
        | "one_away"
        | "cashed"
        | "slip_died"
        | "no_slip_yet"
        | "tailed"
        | "recap"
        | "rank_change";
    };
    CompositeTypes: Record<string, never>;
  };
};

// ---- convenience aliases used across the app ----
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Inserts<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type Views<T extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];

export type Profile = Tables<"profiles">;
/** Own full profile via the `me` view (push_token, quiet hours, premium_until, age_confirmed_at). */
export type MyProfile = Views<"me">;
export type Room = Tables<"rooms">;
export type Slate = Tables<"slates">;
export type Slip = Tables<"slips">;
export type Leg = Tables<"legs">;
export type LegOverride = Tables<"leg_overrides">;
export type RoomEvent = Tables<"room_events">;
export type SlateBoardRow = Views<"slate_board">;
export type RoomStandingsRow = Views<"room_standings">;
