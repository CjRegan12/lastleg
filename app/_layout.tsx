import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/constants/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useNotificationDeepLinks } from "@/lib/notifications";
import { supabaseConfigured } from "@/lib/supabase";

export default function RootLayout() {
  if (!supabaseConfigured) {
    return (
      <View style={styles.splash}>
        <Text style={styles.errTitle}>Last Leg isn't configured</Text>
        <Text style={styles.errBody}>
          This build was made without its Supabase URL and key. Rebuild with the EXPO_PUBLIC_SUPABASE_URL and
          EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY variables set.
        </Text>
      </View>
    );
  }
  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const inAuthGroup = segments[0] === "(auth)";
  // app/join/[code] is reachable signed out (deep link); it handles its own gate
  const onPublicJoin = segments[0] === "join";

  useEffect(() => {
    if (loading) return;
    if (!session && !inAuthGroup && !onPublicJoin) {
      router.replace("/(auth)/sign-in" as never);
    } else if (session && inAuthGroup) {
      router.replace("/(app)" as never);
    }
  }, [session, loading, inAuthGroup, onPublicJoin, router]);

  useNotificationDeepLinks(!!session);

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.live} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: "fade",
      }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
      <Stack.Screen name="join/[code]" options={{ presentation: "modal" }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  errTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  errBody: { color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
});
