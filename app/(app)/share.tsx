import { useRouter } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Button, Screen, T } from "@/components/ui";
import { colors, spacing } from "@/constants/theme";
import { looksLikeShareLink } from "@/lib/slips";

/**
 * Landing route for "Share to Last Leg" from another app. The extension has
 * already handed us a link, text containing a link, or an image file in the
 * App Group container. Hand it to the room picker and get out of the way.
 */
export default function ShareScreen() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, error, resetShareIntent } = useShareIntentContext();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || !hasShareIntent) return;
    const url = shareIntent.webUrl ?? (shareIntent.text ? looksLikeShareLink(shareIntent.text) : null);
    const image = shareIntent.files?.find((f) => f.mimeType.startsWith("image/")) ?? null;
    if (url) {
      handled.current = true;
      resetShareIntent();
      router.replace(`/pick-room?url=${encodeURIComponent(url)}` as never);
    } else if (image) {
      handled.current = true;
      resetShareIntent();
      const q = `image=${encodeURIComponent(image.path)}&w=${image.width ?? 0}&h=${image.height ?? 0}`;
      router.replace(`/pick-room?${q}` as never);
    }
  }, [hasShareIntent, shareIntent, resetShareIntent, router]);

  const nothingUsable = hasShareIntent && !handled.current;

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={styles.center}>
        {!hasShareIntent && !error ? <ActivityIndicator color={colors.muted} /> : null}
        {error || nothingUsable ? (
          <>
            <T variant="title">Couldn't read that share</T>
            <T variant="body" color={colors.muted} style={styles.body}>
              {error ?? "Share a bet link from your sportsbook, or a screenshot of the slip."}
            </T>
            <Button
              title="Go to Live"
              variant="secondary"
              onPress={() => {
                resetShareIntent();
                router.replace("/(app)" as never);
              }}
              style={styles.btn}
            />
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center" },
  body: { marginTop: spacing.sm },
  btn: { marginTop: spacing.xl, alignSelf: "stretch" },
});
