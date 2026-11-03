import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";

import { Button, Input, Screen, T } from "@/components/ui";
import { colors, fonts, spacing } from "@/constants/theme";
import { joinRoomByCode } from "@/lib/rooms";

export default function JoinScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const join = async () => {
    setBusy(true);
    setError(null);
    const res = await joinRoomByCode(clean);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.replace(`/rooms/${res.room.id}` as never);
  };

  return (
    <Screen scroll edges={["bottom"]}>
      <T variant="body" color={colors.muted} style={styles.lead}>
        Paste the 8-character code from your group chat.
      </T>
      <Input
        label="Invite code"
        placeholder="ABCD2345"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        autoFocus
        returnKeyType="go"
        onSubmitEditing={() => clean.length === 8 && join()}
        error={error}
        style={styles.code}
      />
      <Button title="Join room" onPress={join} disabled={clean.length !== 8} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginVertical: spacing.lg },
  // Invite codes are the one tracked string in the app: 8 glyphs you read aloud across a room.
  code: { fontFamily: fonts.condensedBold, fontSize: 28, letterSpacing: 4, textAlign: "center" },
});
