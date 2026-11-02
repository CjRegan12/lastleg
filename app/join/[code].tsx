import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Button, Screen } from "@/components/ui";
import { colors, fontSize, spacing } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { joinRoomByCode } from "@/lib/rooms";

/**
 * Deep link target: groupsweat://join/CODE and https://groupsweat.app/join/CODE.
 * Lives outside (app) so a signed-out tap can show the code and bounce to sign-in.
 */
export default function JoinByLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { session, loading } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef<string | null>(null);

  const clean = (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  useEffect(() => {
    if (loading || !session || !clean) return;
    if (attempted.current === clean) return; // one attempt per code
    attempted.current = clean;
    joinRoomByCode(clean).then((res) => {
      if (res.ok) router.replace(`/rooms/${res.room.id}` as never);
      else setError(res.message);
    });
  }, [loading, session, clean, router]);

  if (loading || (session && !error)) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.live} />
          <Text style={styles.muted}>Joining {clean}...</Text>
        </View>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.title}>You were invited to a room</Text>
          <Text style={styles.code}>{clean}</Text>
          <Text style={styles.muted}>Sign in first, then enter this code.</Text>
          <Button
            title="Sign in"
            onPress={() => router.replace("/(auth)/sign-in" as never)}
            style={styles.btn}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.center}>
        <Text style={styles.title}>Could not join</Text>
        <Text style={styles.muted}>{error}</Text>
        <Button title="Back to rooms" onPress={() => router.replace("/(app)" as never)} style={styles.btn} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: "700" },
  code: { color: colors.text, fontSize: fontSize.xxl, fontWeight: "800", letterSpacing: 4 },
  muted: { color: colors.muted, fontSize: fontSize.md, textAlign: "center" },
  btn: { alignSelf: "stretch", marginTop: spacing.lg },
});
