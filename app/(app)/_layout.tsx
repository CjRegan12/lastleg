import { Redirect, Stack, useSegments } from "expo-router";
import { createContext, useContext, useMemo, useState } from "react";

import { colors, fonts } from "@/constants/theme";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/lib/auth";

export default function AppLayout() {
  const { session, loading } = useAuth();
  // Gate in render, not in an effect: every (app) screen calls useUserId(), which
  // throws without a session. An effect-based redirect in the root layout runs
  // after the first render, so on a fresh install (app)/index rendered once with
  // no session and the throw was fatal in release (RCTFatal, no error boundary).
  if (loading) return null;
  if (!session) return <Redirect href={"/(auth)/sign-in" as never} />;
  return <SignedIn userId={session.user.id} />;
}

const OnboardingContext = createContext<{ markDone: () => void }>({ markDone: () => undefined });
/** The welcome screen calls this right before leaving so the gate below lets it through. */
export const useOnboarding = () => useContext(OnboardingContext);

/** First run: pick a name before anything else. Lives here so no tab renders for an un-onboarded user. */
function SignedIn({ userId }: { userId: string }) {
  const { profile, loading, error } = useProfile(userId);
  const [done, setDone] = useState(false);
  const ctx = useMemo(() => ({ markDone: () => setDone(true) }), []);
  const segments = useSegments() as string[];
  const onWelcome = segments.includes("welcome");
  if (loading && !profile) return null;
  // If the profile can't be read, don't trap the user; the app still works.
  if (profile && !profile.onboarded_at && !done && !error && !onWelcome) {
    return <Redirect href={"/welcome" as never} />;
  }
  return (
    <OnboardingContext.Provider value={ctx}>
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
      <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="pick-room" options={{ title: "Which room?", presentation: "modal" }} />
      <Stack.Screen name="share" options={{ headerShown: false }} />
      <Stack.Screen name="rooms/new" options={{ title: "New room", presentation: "modal" }} />
      <Stack.Screen name="join" options={{ title: "Join a room", presentation: "modal" }} />
      <Stack.Screen name="rooms/[id]/index" options={{ title: "" }} />
      <Stack.Screen name="rooms/[id]/slip/[slipId]" options={{ title: "Slip" }} />
      <Stack.Screen name="rooms/[id]/recap/[slateId]" options={{ title: "Recap" }} />
      <Stack.Screen name="add-slip" options={{ title: "Add slip", presentation: "modal" }} />
      <Stack.Screen name="profile" options={{ title: "Settings" }} />
    </Stack>
    </OnboardingContext.Provider>
  );
}
