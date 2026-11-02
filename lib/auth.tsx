import type { Session } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "@/lib/supabase";

interface AuthContextValue {
  session: Session | null;
  /** True until the persisted session has been read once. */
  loading: boolean;
  signInWithApple: () => Promise<void>;
  sendPhoneOtp: (phone: string) => Promise<void>;
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>;
  /** Dev only: email magic link. No-op outside __DEV__. */
  sendDevMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithApple = useCallback(async () => {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new Error("Apple did not return an identity token");
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
    });
    if (error) throw error;
  }, []);

  const sendPhoneOtp = useCallback(async (phone: string) => {
    const { error } = await supabase.auth.signInWithOtp({ phone: normalizePhone(phone) });
    if (error) throw error;
  }, []);

  const verifyPhoneOtp = useCallback(async (phone: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({
      phone: normalizePhone(phone),
      token: token.trim(),
      type: "sms",
    });
    if (error) throw error;
  }, []);

  const sendDevMagicLink = useCallback(async (email: string) => {
    if (!__DEV__) return;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: "lastleg://" },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      signInWithApple,
      sendPhoneOtp,
      verifyPhoneOtp,
      sendDevMagicLink,
      signOut,
    }),
    [session, loading, signInWithApple, sendPhoneOtp, verifyPhoneOtp, sendDevMagicLink, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useSession(): Session | null {
  return useAuth().session;
}

/** Current user id or throws. Use inside screens that only render behind the auth gate. */
export function useUserId(): string {
  const session = useSession();
  if (!session) throw new Error("No session");
  return session.user.id;
}

/** "(516) 448-1191" -> "+15164481191". Assumes US when no country code. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Stamp profiles.age_confirmed_at once after the first sign-in. The read goes
 * through `me` (the only view that exposes the private columns); the write goes
 * to `profiles`, which the owner may update for this column.
 */
export async function confirmAge(userId: string): Promise<void> {
  const { data } = await supabase.from("me").select("age_confirmed_at").maybeSingle();
  if (data?.age_confirmed_at) return;
  await supabase
    .from("profiles")
    .update({ age_confirmed_at: new Date().toISOString() })
    .eq("id", userId);
}
