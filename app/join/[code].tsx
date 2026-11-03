import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Button, Screen, T } from "@/components/ui";
import { colors, spacing } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { joinRoomByCode } from "@/lib/rooms";

/**
 * Deep link target: lastleg://join/CODE and https://lastleg.io/join/CODE.
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
          <ActivityIndicator color={colors.muted} />
          <T variant="body" color={colors.muted}>
            Joining {clean}...
          </T>
        </View>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <View style={styles.center}>
          <T variant="title">You were invited to a room</T>
          <T variant="numberLg" style={styles.code}>
            {clean}
          </T>
          <T variant="body" color={colors.muted} style={styles.muted}>
            Sign in first, then enter this code.
          </T>
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
        <T variant="title">Could not join</T>
        <T variant="body" color={colors.muted} style={styles.muted}>
          {error}
        </T>
        <Button title="Back to rooms" onPress={() => router.replace("/(app)" as never)} style={styles.btn} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  // Invite codes are the one tracked string in the app: 8 glyphs you read aloud across a room.
  code: { letterSpacing: 4 },
  muted: { textAlign: "center" },
  btn: { alignSelf: "stretch", marginTop: spacing.lg },
});
