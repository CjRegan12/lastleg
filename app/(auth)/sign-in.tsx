import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { RGFooter } from "@/components/RGFooter";
import { Button, Input, Screen } from "@/components/ui";
import { APP_NAME } from "@/constants/books";
import { colors, fonts, fontSize, radius, spacing } from "@/constants/theme";
import { confirmAge, useAuth } from "@/lib/auth";

// Phone OTP is parked until there are users (needs a paid SMS provider in
// Supabase). The auth helpers for it still exist in lib/auth.tsx.

export default function SignInScreen() {
  const { session, signInWithApple, sendDevMagicLink } = useAuth();
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState<null | "apple" | "email">(null);
  const [email, setEmail] = useState("");
  const [appleAvailable, setAppleAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  // Stamp the 21+ self-declaration once a session exists (RootNavigator redirects right after).
  useEffect(() => {
    if (session && ageOk) confirmAge(session.user.id).catch(() => undefined);
  }, [session, ageOk]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/canceled/i.test(msg)) Alert.alert("Sign in failed", msg);
    } finally {
      setBusy(null);
    }
  };

  const canUse = ageOk && busy === null;

  return (
    <Screen scroll>
      <View style={styles.fill}>
        <View style={styles.hero}>
          <Text style={styles.logo}>{APP_NAME}</Text>
          <Text style={styles.tagline}>Your group chat, but the slips grade themselves.</Text>
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ageOk }}
          onPress={() => setAgeOk((v) => !v)}
          style={styles.gate}
        >
          <View style={[styles.checkbox, ageOk && styles.checkboxOn]}>
            {ageOk ? <Text style={styles.check}>✓</Text> : null}
          </View>
          <Text style={styles.gateText}>I am 21 or older</Text>
        </Pressable>

        {appleAvailable ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={radius.md}
            style={[styles.apple, !canUse && styles.dim]}
            onPress={() => {
              if (!canUse) return;
              run("apple", signInWithApple);
            }}
          />
        ) : appleAvailable === false ? (
          <Text style={styles.unavailable}>Sign in with Apple isn't available on this device.</Text>
        ) : null}

        {!ageOk ? <Text style={styles.hint}>Confirm you're 21+ to continue.</Text> : null}

        {__DEV__ ? (
          <View style={styles.dev}>
            <Text style={styles.devLabel}>DEV: email magic link</Text>
            <Input
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />
            <Button
              title="Send magic link"
              variant="secondary"
              disabled={!canUse || !email.includes("@")}
              loading={busy === "email"}
              onPress={() =>
                run("email", async () => {
                  await sendDevMagicLink(email);
                  Alert.alert("Check your inbox", "Open the link on this phone.");
                })
              }
            />
          </View>
        ) : null}

        <RGFooter />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { paddingTop: spacing.xxl * 2, paddingBottom: spacing.xxl, alignItems: "center" },
  logo: { color: colors.text, fontFamily: fonts.condensedBold, fontSize: 56, lineHeight: 58, letterSpacing: -1 },
  tagline: { color: colors.muted, fontFamily: fonts.body, fontSize: fontSize.lg, lineHeight: 24, marginTop: spacing.sm, textAlign: "center", maxWidth: 300 },
  gate: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  checkboxOn: { backgroundColor: colors.text, borderColor: colors.text },
  check: { color: colors.bg, fontFamily: fonts.condensedBold, fontSize: 15 },
  gateText: { color: colors.text, fontFamily: fonts.bodyMedium, fontSize: fontSize.md + 1 },
  apple: { height: 48, width: "100%" },
  dim: { opacity: 0.5 },
  unavailable: { color: colors.muted, fontFamily: fonts.body, fontSize: fontSize.sm, textAlign: "center" },
  hint: { color: colors.muted, fontFamily: fonts.body, fontSize: fontSize.sm, textAlign: "center", marginTop: spacing.md },
  dev: {
    marginTop: spacing.xxl,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.oneAway,
  },
  devLabel: { color: colors.oneAway, fontFamily: fonts.bodySemi, fontSize: fontSize.xs, marginBottom: spacing.sm },
});
