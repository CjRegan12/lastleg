import { Redirect, Stack } from "expo-router";

import { colors, fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth";

export default function AppLayout() {
  const { session, loading } = useAuth();
  // Gate in render, not in an effect: every (app) screen calls useUserId(), which
  // throws without a session. An effect-based redirect in the root layout runs
  // after the first render, so on a fresh install (app)/index rendered once with
  // no session and the throw was fatal in release (RCTFatal, no error boundary).
  if (loading) return null;
  if (!session) return <Redirect href={"/(auth)/sign-in" as never} />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontFamily: fonts.condensedBold, fontSize: 22 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="pick-room" options={{ title: "Which room?", presentation: "modal" }} />
      <Stack.Screen name="rooms/new" options={{ title: "New room", presentation: "modal" }} />
      <Stack.Screen name="join" options={{ title: "Join a room", presentation: "modal" }} />
      <Stack.Screen name="rooms/[id]/index" options={{ title: "" }} />
      <Stack.Screen name="rooms/[id]/slip/[slipId]" options={{ title: "Slip" }} />
      <Stack.Screen name="rooms/[id]/recap/[slateId]" options={{ title: "Recap" }} />
      <Stack.Screen name="add-slip" options={{ title: "Add slip", presentation: "modal" }} />
      <Stack.Screen name="profile" options={{ title: "Settings" }} />
    </Stack>
  );
}
