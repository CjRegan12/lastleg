import { useCallback, useEffect, useState } from "react";

import type { Profile } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

export function useProfile(userId: string | null | undefined) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error: err } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    setError(err?.message ?? null);
    setProfile(data ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { profile, loading, error, refresh, setProfile };
}
