import { Stack } from "expo-router";

import { colors } from "@/constants/theme";

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontWeight: "700" },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Rooms" }} />
      <Stack.Screen name="rooms/new" options={{ title: "New room", presentation: "modal" }} />
      <Stack.Screen name="join" options={{ title: "Join a room", presentation: "modal" }} />
      <Stack.Screen name="rooms/[id]/index" options={{ title: "" }} />
      <Stack.Screen name="rooms/[id]/slip/[slipId]" options={{ title: "Slip" }} />
      <Stack.Screen name="rooms/[id]/recap/[slateId]" options={{ title: "Recap" }} />
      <Stack.Screen name="add-slip" options={{ title: "Add slip", presentation: "modal" }} />
      <Stack.Screen name="profile" options={{ title: "Profile" }} />
    </Stack>
  );
}
