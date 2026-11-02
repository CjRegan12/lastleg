import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from "react-native";

import { ConfirmSlip } from "@/components/ConfirmSlip";
import { Button, Screen } from "@/components/ui";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { useUserId } from "@/lib/auth";
import {
  callParseSlip,
  type ParsedSlip,
  pickAndPrepareImage,
  type PreparedImage,
  saveSlip,
  uploadSlipImage,
} from "@/lib/slips";

type Step =
  | { kind: "pick" }
  | { kind: "uploading"; image: PreparedImage }
  | { kind: "parsing"; image: PreparedImage; storagePath: string }
  | { kind: "confirm"; image: PreparedImage; storagePath: string; parsed: ParsedSlip; draft: ParsedSlip }
  | { kind: "saving"; image: PreparedImage; storagePath: string; parsed: ParsedSlip; draft: ParsedSlip };

export default function AddSlipScreen() {
  const { room: roomId } = useLocalSearchParams<{ room: string }>();
  const router = useRouter();
  const userId = useUserId();
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);

  const start = async (source: "library" | "camera") => {
    if (!roomId) return;
    setError(null);
    try {
      const image = await pickAndPrepareImage(source);
      if (!image) return;
      setStep({ kind: "uploading", image });
      const storagePath = await uploadSlipImage(userId, image.uri);
      setStep({ kind: "parsing", image, storagePath });
      const parsed = await callParseSlip(storagePath, roomId);
      setStep({ kind: "confirm", image, storagePath, parsed, draft: parsed });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep({ kind: "pick" });
    }
  };

  const submit = async () => {
    if (step.kind !== "confirm" || !roomId) return;
    const problems = validate(step.draft);
    if (problems) {
      Alert.alert("Check the slip", problems);
      return;
    }
    setStep({ ...step, kind: "saving" });
    try {
      await saveSlip({
        userId,
        roomId,
        screenshotPath: step.storagePath,
        parsed: step.parsed,
        confirmed: step.draft,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep({ ...step, kind: "confirm" });
    }
  };

  if (!roomId) {
    return (
      <Screen edges={["bottom"]}>
        <Text style={styles.error}>Missing room. Open this from a room board.</Text>
      </Screen>
    );
  }

  if (step.kind === "pick") {
    return (
      <Screen scroll edges={["bottom"]}>
        <Text style={styles.lead}>
          Screenshot the bet slip in your sportsbook app, then add it here. We read the legs, match them to
          tonight's games and grade them live for the room.
        </Text>
        <Button title="Choose screenshot" onPress={() => start("library")} />
        <Button title="Take a photo" variant="secondary" onPress={() => start("camera")} style={styles.gap} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.fine}>Images are stored privately and only used to read your slip.</Text>
      </Screen>
    );
  }

  if (step.kind === "uploading" || step.kind === "parsing") {
    return (
      <Screen edges={["bottom"]}>
        <View style={styles.center}>
          <Image source={{ uri: step.image.uri }} style={styles.preview} resizeMode="contain" />
          <ActivityIndicator color={colors.live} style={styles.gap} />
          <Text style={styles.status}>{step.kind === "uploading" ? "Uploading..." : "Reading your slip..."}</Text>
          <Text style={styles.fine}>Usually a few seconds.</Text>
        </View>
      </Screen>
    );
  }

  const saving = step.kind === "saving";
  return (
    <Screen scroll edges={["bottom"]}>
      <Image source={{ uri: step.image.uri }} style={styles.thumb} resizeMode="cover" />
      <ConfirmSlip value={step.draft} onChange={(draft) => !saving && setStep({ ...step, draft })} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Add to the board" onPress={submit} loading={saving} style={styles.gap} />
      <Button
        title="Start over"
        variant="ghost"
        disabled={saving}
        onPress={() => {
          setError(null);
          setStep({ kind: "pick" });
        }}
        style={styles.gapSm}
      />
    </Screen>
  );
}

function validate(s: ParsedSlip): string | null {
  if (s.stake <= 0) return "Stake has to be more than $0.";
  if (s.potential_payout < s.stake) return "Payout should be at least the stake (it includes the stake).";
  if (s.odds_american === 0 || (s.odds_american > -100 && s.odds_american < 100)) {
    return "Odds look off. American odds are -100 or lower, or +100 or higher.";
  }
  if (s.legs.length === 0) return "A slip needs at least one leg.";
  const empty = s.legs.findIndex((l) => l.selection.trim().length === 0);
  if (empty >= 0) return `Leg ${empty + 1} needs a selection.`;
  return null;
}

const styles = StyleSheet.create({
  lead: { color: colors.muted, fontSize: fontSize.md, marginVertical: spacing.lg, lineHeight: 21 },
  gap: { marginTop: spacing.md },
  gapSm: { marginTop: spacing.sm },
  error: { color: colors.lost, fontSize: fontSize.sm, marginTop: spacing.md },
  fine: { color: colors.pending, fontSize: fontSize.xs, marginTop: spacing.lg, textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  preview: { width: "70%", aspectRatio: 9 / 16, borderRadius: radius.lg, backgroundColor: colors.surface },
  thumb: {
    width: 72,
    height: 128,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginVertical: spacing.md,
    alignSelf: "flex-end",
  },
  status: { color: colors.text, fontSize: fontSize.md, fontWeight: "600", marginTop: spacing.sm },
});
