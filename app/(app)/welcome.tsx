import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";

import { Avatar, Button, Input, Screen, T } from "@/components/ui";
import { colors, spacing } from "@/constants/theme";
import { useProfile } from "@/hooks/useProfile";
import { useUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

import { useOnboarding } from "./_layout";

/**
 * First run after sign-in. Apple hides most people's email, so the generated
 * handle is junk like pn5566msh6; this is where they pick the name the room
 * will see. Sets onboarded_at so it shows once.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const userId = useUserId();
  const { profile, refresh } = useProfile(userId);
  const { markDone } = useOnboarding();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prefilled = useRef(false);
  useEffect(() => {
    if (profile && !prefilled.current) {
      prefilled.current = true;
      setHandle(looksGenerated(profile.handle) ? "" : profile.handle);
    }
  }, [profile]);

  const save = async () => {
    const clean = handle.trim();
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(clean)) {
      setError("3 to 24 letters, numbers or underscores.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("profiles")
      .update({ handle: clean, onboarded_at: new Date().toISOString() })
      .eq("id", userId);
    setBusy(false);
    if (err) {
      setError(err.code === "23505" ? "That name is taken." : err.message);
      return;
    }
    await refresh();
    markDone();
    router.replace("/(app)" as never);
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>
        <View style={styles.body}>
          <Avatar handle={handle || profile?.handle} size={72} />
          <T variant="display" style={styles.title}>
            What should the room call you?
          </T>
          <T variant="body" color={colors.muted} style={styles.sub}>
            This shows on every slip you drop. You can change it later in settings.
          </T>
          <Input
            value={handle}
            onChangeText={(v) => {
              setHandle(v);
              if (error) setError(null);
            }}
            placeholder="your name"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            maxLength={24}
            returnKeyType="done"
            onSubmitEditing={save}
            error={error}
            containerStyle={styles.input}
          />
        </View>
        <Button title="That's me" onPress={save} loading={busy} disabled={handle.trim().length < 3} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Handles the signup trigger derives from a private-relay email: letters+digits soup. */
function looksGenerated(h: string): boolean {
  return /^[a-z0-9]{8,}$/.test(h) && /\d/.test(h) && !/_/.test(h);
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingBottom: spacing.lg },
  body: { flex: 1, justifyContent: "center" },
  title: { marginTop: spacing.xl, maxWidth: 320 },
  sub: { marginTop: spacing.sm, marginBottom: spacing.xl, maxWidth: 320 },
  input: { marginBottom: 0 },
});
