import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { RGFooter } from "@/components/RGFooter";
import { Button, Input, Screen } from "@/components/ui";
import { APP_NAME } from "@/constants/books";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { confirmAge, useAuth } from "@/lib/auth";

type PhoneStep = "enter" | "verify";

export default function SignInScreen() {
  const { session, signInWithApple, sendPhoneOtp, verifyPhoneOtp, sendDevMagicLink } = useAuth();
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState<null | "apple" | "phone" | "email">(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<PhoneStep>("enter");
  const [email, setEmail] = useState("");
  const [appleAvailable, setAppleAvailable] = useState(false);

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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>
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
        ) : null}

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.or}>or use your phone</Text>
          <View style={styles.line} />
        </View>

        {step === "enter" ? (
          <>
            <Input
              label="Phone"
              placeholder="(516) 555-0100"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              value={phone}
              onChangeText={setPhone}
              editable={busy === null}
            />
            <Button
              title="Text me a code"
              disabled={!canUse || phone.replace(/\D/g, "").length < 10}
              loading={busy === "phone"}
              onPress={() =>
                run("phone", async () => {
                  await sendPhoneOtp(phone);
                  setStep("verify");
                })
              }
            />
          </>
        ) : (
          <>
            <Input
              label={`Code sent to ${phone}`}
              placeholder="123456"
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              value={code}
              onChangeText={setCode}
              maxLength={8}
              editable={busy === null}
            />
            <Button
              title="Verify"
              disabled={!canUse || code.trim().length < 4}
              loading={busy === "phone"}
              onPress={() => run("phone", () => verifyPhoneOtp(phone, code))}
            />
            <Button
              title="Use a different number"
              variant="ghost"
              onPress={() => {
                setStep("enter");
                setCode("");
              }}
              style={styles.ghost}
            />
          </>
        )}

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
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { paddingTop: spacing.xxl * 2, paddingBottom: spacing.xxl, alignItems: "center" },
  logo: { color: colors.text, fontSize: fontSize.xxl, fontWeight: "800", letterSpacing: -0.5 },
  tagline: { color: colors.muted, fontSize: fontSize.md, marginTop: spacing.sm, textAlign: "center" },
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
  checkboxOn: { backgroundColor: colors.live, borderColor: colors.live },
  check: { color: colors.white, fontWeight: "800", fontSize: 14 },
  gateText: { color: colors.text, fontSize: fontSize.md, fontWeight: "600" },
  apple: { height: 48, width: "100%" },
  dim: { opacity: 0.5 },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: spacing.xl },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { color: colors.muted, fontSize: fontSize.sm, marginHorizontal: spacing.md },
  ghost: { marginTop: spacing.sm },
  dev: {
    marginTop: spacing.xxl,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.oneAway,
  },
  devLabel: { color: colors.oneAway, fontSize: fontSize.xs, fontWeight: "700", marginBottom: spacing.sm },
});
