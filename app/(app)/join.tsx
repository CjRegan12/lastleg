import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { Button, Input, Screen } from "@/components/ui";
import { colors, fontSize, spacing } from "@/constants/theme";
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
      <Text style={styles.lead}>Paste the 8-character code from your group chat.</Text>
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
  lead: { color: colors.muted, fontSize: fontSize.md, marginVertical: spacing.lg, lineHeight: 21 },
  code: { letterSpacing: 4, fontSize: fontSize.xl, fontWeight: "700", textAlign: "center" },
});
