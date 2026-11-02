import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/constants/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useNotificationDeepLinks } from "@/lib/notifications";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" backgroundColor={colors.bg} />
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
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
});
