import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";

import { Button, Input, Screen, T } from "@/components/ui";
import { colors, spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";

export default function NewRoomScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 40;

  const create = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("create_room", { p_name: trimmed });
    setBusy(false);
    if (err || !data) {
      setError(err?.message ?? "Could not create the room");
      return;
    }
    router.replace(`/rooms/${data.id}` as never);
  };

  return (
    <Screen scroll edges={["bottom"]}>
      <T variant="body" color={colors.muted} style={styles.lead}>
        Name it after the group chat. You can share the invite code right after.
      </T>
      <Input
        label="Room name"
        placeholder="Sunday Degens"
        value={name}
        onChangeText={setName}
        maxLength={40}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => valid && create()}
        error={error}
        hint={`${trimmed.length}/40`}
      />
      <Button title="Create room" onPress={create} disabled={!valid} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginVertical: spacing.lg },
});
