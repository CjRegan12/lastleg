import { useCallback, useEffect, useState } from "react";

import type { MyProfile } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

/**
 * The signed-in user's own full profile, read through the `me` view (the only
 * place the private columns like push_token and quiet hours are readable).
 * `me` is read-only; writes still go to `profiles` filtered by id.
 */
export function useProfile(userId: string | null | undefined) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    // `me` already filters to auth.uid(); userId only gates the fetch and re-runs it on account switch.
    const { data, error: err } = await supabase.from("me").select("*").maybeSingle();
    setError(err?.message ?? null);
    setProfile(data ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { profile, loading, error, refresh, setProfile };
}
