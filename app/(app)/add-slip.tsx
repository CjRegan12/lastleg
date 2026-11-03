import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, StyleSheet, View } from "react-native";

import { ConfirmSlip } from "@/components/ConfirmSlip";
import { Button, Input, Screen, T } from "@/components/ui";
import { colors, radius, spacing } from "@/constants/theme";
import { useUserId } from "@/lib/auth";
import {
  callParseSlip,
  callParseSlipFromLink,
  looksLikeShareLink,
  type ParsedSlip,
  pickAndPrepareImage,
  type PreparedImage,
  saveSlip,
  uploadSlipImage,
} from "@/lib/slips";

/** image is null when the slip came in as a share link (the server stored the preview). */
type Step =
  | { kind: "pick" }
  | { kind: "uploading"; image: PreparedImage }
  | { kind: "parsing"; image: PreparedImage | null; storagePath: string | null }
  | { kind: "confirm"; image: PreparedImage | null; storagePath: string; parsed: ParsedSlip; draft: ParsedSlip }
  | { kind: "saving"; image: PreparedImage | null; storagePath: string; parsed: ParsedSlip; draft: ParsedSlip };

export default function AddSlipScreen() {
  // `url` arrives from the share sheet / paste flow; `room` from the picker.
  const { room: roomId, url: sharedUrl } = useLocalSearchParams<{ room: string; url?: string }>();
  const router = useRouter();
  const userId = useUserId();
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");

  const startFromLink = async (raw: string) => {
    if (!roomId) return;
    const url = looksLikeShareLink(raw);
    if (!url) {
      setError("That doesn't look like a sportsbook share link.");
      return;
    }
    setError(null);
    setStep({ kind: "parsing", image: null, storagePath: null });
    try {
      const { parsed, storagePath } = await callParseSlipFromLink(url, roomId);
      setStep({ kind: "confirm", image: null, storagePath, parsed, draft: parsed });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep({ kind: "pick" });
    }
  };

  // Shared in from another app: go straight to parsing, once.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (sharedUrl && roomId && !autoStarted.current) {
      autoStarted.current = true;
      setLink(sharedUrl);
      void startFromLink(sharedUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedUrl, roomId]);

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
        <T variant="small" color={colors.lost} style={styles.error}>
          Missing room. Open this from a room board.
        </T>
      </Screen>
    );
  }

  if (step.kind === "pick") {
    return (
      <Screen scroll edges={["bottom"]}>
        <T variant="body" color={colors.muted} style={styles.lead}>
          In your sportsbook, open the bet and tap Share. Paste the link here, or share it straight to Last Leg.
        </T>
        <Input
          label="Share link"
          placeholder="https://sportsbook.fanduel.com/..."
          value={link}
          onChangeText={(v) => {
            setLink(v);
            if (error) setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => link.trim() && startFromLink(link)}
        />
        <Button title="Read this slip" onPress={() => startFromLink(link)} disabled={!link.trim()} />
        <T variant="small" style={styles.or}>
          Or use a screenshot
        </T>
        <Button title="Choose screenshot" variant="secondary" onPress={() => start("library")} />
        <Button title="Take a photo" variant="ghost" onPress={() => start("camera")} style={styles.gapSm} />
        {error ? (
          <T variant="small" color={colors.lost} style={styles.error}>
            {error}
          </T>
        ) : null}
        <T variant="micro" style={styles.fine}>
          Images are stored privately and only used to read your slip.
        </T>
      </Screen>
    );
  }

  if (step.kind === "uploading" || step.kind === "parsing") {
    return (
      <Screen edges={["bottom"]}>
        <View style={styles.center}>
          {step.image ? (
            <Image source={{ uri: step.image.uri }} style={styles.preview} resizeMode="contain" />
          ) : null}
          <ActivityIndicator color={colors.muted} style={styles.gap} />
          <T variant="heading" style={styles.status}>
            {step.kind === "uploading" ? "Uploading..." : step.image ? "Reading your slip..." : "Fetching your slip..."}
          </T>
          <T variant="micro" style={styles.fine}>
            Usually a few seconds.
          </T>
        </View>
      </Screen>
    );
  }

  const saving = step.kind === "saving";
  return (
    <Screen scroll edges={["bottom"]}>
      {step.image ? <Image source={{ uri: step.image.uri }} style={styles.thumb} resizeMode="cover" /> : null}
      <ConfirmSlip value={step.draft} onChange={(draft) => !saving && setStep({ ...step, draft })} />
      {error ? (
        <T variant="small" color={colors.lost} style={styles.error}>
          {error}
        </T>
      ) : null}
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
  lead: { marginVertical: spacing.lg },
  or: { marginTop: spacing.xl, marginBottom: spacing.sm },
  gap: { marginTop: spacing.md },
  gapSm: { marginTop: spacing.sm },
  error: { marginTop: spacing.md },
  fine: { marginTop: spacing.lg, textAlign: "center" },
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
  status: { marginTop: spacing.sm },
});
