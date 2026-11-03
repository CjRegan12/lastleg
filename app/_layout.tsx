import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { ShareIntentProvider } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/constants/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useNotificationDeepLinks } from "@/lib/notifications";
import { supabaseConfigured } from "@/lib/supabase";

// Expo Router mounts this as a React error boundary around the whole tree. On the
// new architecture a throw during render otherwise goes straight to the native
// fatal path (RCTFatal -> SIGABRT), skipping ErrorUtils and any try/catch at the
// entry point. This is the only hook that turns such a throw into a screen.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const stack = error.stack ? String(error.stack).split("\n").slice(0, 10).join("\n") : "";
  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.errScroll}>
      <Text style={styles.errTitle}>Last Leg hit an error</Text>
      <Text style={styles.errBody}>{error.message || String(error)}</Text>
      {stack ? <Text style={styles.errStack}>{stack}</Text> : null}
      <Pressable onPress={() => void retry()} style={styles.errButton}>
        <Text style={styles.errButtonText}>Try again</Text>
      </Pressable>
    </ScrollView>
  );
}

// Keep the splash up until fonts are in (or failed). Never let this throw.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

const FONTS = {
  "Barlow-Regular": require("../assets/fonts/Barlow-Regular.ttf"),
  "Barlow-Medium": require("../assets/fonts/Barlow-Medium.ttf"),
  "Barlow-SemiBold": require("../assets/fonts/Barlow-SemiBold.ttf"),
  "BarlowCondensed-SemiBold": require("../assets/fonts/BarlowCondensed-SemiBold.ttf"),
  "BarlowCondensed-Bold": require("../assets/fonts/BarlowCondensed-Bold.ttf"),
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONTS);
  const fontsSettled = fontsLoaded || !!fontError;

  useEffect(() => {
    if (fontsSettled) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsSettled]);

  if (!fontsSettled) return null;

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
        <ShareIntentProvider options={{ resetOnBackground: false }}>
          <AuthProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </AuthProvider>
        </ShareIntentProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const inAuthGroup = segments[0] === "(auth)";
  // Signed-out gating lives in app/(app)/_layout.tsx (render-time Redirect).
  // app/join/[code] is reachable signed out (deep link); it handles its own gate.

  useEffect(() => {
    if (loading) return;
    if (session && inAuthGroup) {
      router.replace("/(app)" as never);
    }
  }, [session, loading, inAuthGroup, router]);

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
  errScroll: { padding: 24, paddingTop: 80, alignItems: "stretch" },
  errStack: { color: colors.muted, fontSize: 11, fontFamily: "Menlo", lineHeight: 16, marginTop: 16 },
  errButton: {
    marginTop: 24,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.live,
  },
  errButtonText: { color: colors.bg, fontWeight: "700", fontSize: 15 },
});
