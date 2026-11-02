import * as Linking from "expo-linking";
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";

import { RGFooter } from "@/components/RGFooter";
import { Avatar, Button, Input, Screen, Segmented } from "@/components/ui";
import { colors, fontSize, radius, spacing } from "@/constants/theme";
import { useProfile } from "@/hooks/useProfile";
import { useAuth, useUserId } from "@/lib/auth";
import type { RoomStandingsRow } from "@/lib/database.types";
import { formatMoney } from "@/lib/format";
import { clearPushToken, hasPushPermission, registerForPushAsync } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";

const PRIVACY_URL = "https://groupsweat.app/privacy"; // placeholder until the site exists
const HOURS = Array.from({ length: 24 }, (_, h) => String(h));
const HOUR_LABELS = Object.fromEntries(
  HOURS.map((h) => {
    const n = Number(h);
    const label = n === 0 ? "12a" : n < 12 ? `${n}a` : n === 12 ? "12p" : `${n - 12}p`;
    return [h, label];
  }),
) as Record<string, string>;

export default function ProfileScreen() {
  const userId = useUserId();
  const { signOut } = useAuth();
  const { profile, refresh } = useProfile(userId);
  const [handle, setHandle] = useState("");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [savingHandle, setSavingHandle] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [quietOn, setQuietOn] = useState(false);
  const [standings, setStandings] = useState<RoomStandingsRow[]>([]);

  useEffect(() => {
    if (!profile) return;
    setHandle(profile.handle);
    setQuietOn(profile.quiet_hours_start != null && profile.quiet_hours_end != null);
    hasPushPermission().then((granted) => setPushOn(granted && !!profile.push_token));
  }, [profile]);

  useEffect(() => {
    supabase
      .from("room_standings")
      .select("*")
      .eq("user_id", userId)
      .then(({ data }) => setStandings(data ?? []));
  }, [userId]);

  const season = useMemo(() => {
    const won = standings.reduce((s, r) => s + (r.won ?? 0), 0);
    const lost = standings.reduce((s, r) => s + (r.lost ?? 0), 0);
    const profit = standings.reduce((s, r) => s + (r.profit ?? 0), 0);
    const risked = standings.reduce((s, r) => s + (r.risked ?? 0), 0);
    const badBeats = standings.reduce((s, r) => s + (r.bad_beats ?? 0), 0);
    return { won, lost, profit, risked, badBeats, roi: risked > 0 ? (100 * profit) / risked : 0 };
  }, [standings]);

  const saveHandle = async () => {
    const clean = handle.trim();
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(clean)) {
      setHandleError("3 to 24 letters, numbers or underscores.");
      return;
    }
    setSavingHandle(true);
    setHandleError(null);
    const { error } = await supabase.from("profiles").update({ handle: clean }).eq("id", userId);
    setSavingHandle(false);
    if (error) {
      setHandleError(error.code === "23505" ? "That handle is taken." : error.message);
      return;
    }
    refresh();
  };

  const togglePush = async (next: boolean) => {
    setPushBusy(true);
    if (next) {
      const res = await registerForPushAsync(userId);
      if (res.ok) {
        setPushOn(true);
      } else {
        setPushOn(false);
        const why =
          res.reason === "denied"
            ? "Notifications are off for Group Sweat in iOS Settings."
            : res.reason === "simulator"
              ? "Push needs a real device."
              : res.reason === "no_project_id"
                ? "EAS projectId is not set in app.json."
                : "Could not register for push.";
        Alert.alert("Push not enabled", why, [
          { text: "OK" },
          ...(res.reason === "denied" ? [{ text: "Open Settings", onPress: () => Linking.openSettings() }] : []),
        ]);
      }
    } else {
      await clearPushToken(userId);
      setPushOn(false);
    }
    setPushBusy(false);
  };

  const setQuiet = async (start: number | null, end: number | null) => {
    await supabase.from("profiles").update({ quiet_hours_start: start, quiet_hours_end: end }).eq("id", userId);
    refresh();
  };

  const toggleQuiet = (next: boolean) => {
    setQuietOn(next);
    if (next) setQuiet(profile?.quiet_hours_start ?? 0, profile?.quiet_hours_end ?? 8);
    else setQuiet(null, null);
  };

  return (
    <Screen scroll edges={["bottom"]}>
      <View style={styles.hero}>
        <Avatar handle={profile?.handle} size={64} />
        <Text style={styles.handle}>{profile?.handle ?? ""}</Text>
      </View>

      <Text style={styles.section}>Handle</Text>
      <Input
        value={handle}
        onChangeText={setHandle}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={24}
        error={handleError}
        hint="This is what the room sees on your slips."
      />
      <Button
        title="Save handle"
        size="sm"
        variant="secondary"
        onPress={saveHandle}
        loading={savingHandle}
        disabled={!profile || handle.trim() === profile.handle}
      />

      <Text style={styles.section}>Notifications</Text>
      <View style={styles.rowCard}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Push notifications</Text>
          <Text style={styles.rowSub}>One away, cashed, slip died, recap.</Text>
        </View>
        <Switch
          value={pushOn}
          onValueChange={togglePush}
          disabled={pushBusy}
          trackColor={{ true: colors.live, false: colors.border }}
          thumbColor={colors.white}
        />
      </View>
      <View style={styles.rowCard}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Quiet hours</Text>
          <Text style={styles.rowSub}>No pushes between these hours (your time).</Text>
        </View>
        <Switch
          value={quietOn}
          onValueChange={toggleQuiet}
          trackColor={{ true: colors.live, false: colors.border }}
          thumbColor={colors.white}
        />
      </View>
      {quietOn && profile ? (
        <View style={styles.quiet}>
          <Text style={styles.quietLabel}>From</Text>
          <Segmented
            options={HOURS}
            value={String(profile.quiet_hours_start ?? 0)}
            onChange={(h) => setQuiet(Number(h), profile.quiet_hours_end ?? 8)}
            labels={HOUR_LABELS}
            scrollable
          />
          <Text style={[styles.quietLabel, styles.gapSm]}>Until</Text>
          <Segmented
            options={HOURS}
            value={String(profile.quiet_hours_end ?? 8)}
            onChange={(h) => setQuiet(profile.quiet_hours_start ?? 0, Number(h))}
            labels={HOUR_LABELS}
            scrollable
          />
        </View>
      ) : null}

      <Text style={styles.section}>Season</Text>
      <View style={styles.statsGrid}>
        <Stat label="record" value={`${season.won}-${season.lost}`} />
        <Stat
          label="net"
          value={formatMoney(season.profit, { signed: true })}
          color={season.profit > 0 ? colors.won : season.profit < 0 ? colors.lost : undefined}
        />
        <Stat label="ROI" value={`${season.roi.toFixed(1)}%`} />
        <Stat label="bad beats" value={String(season.badBeats)} color={season.badBeats > 0 ? colors.oneAway : undefined} />
      </View>
      <Text style={styles.fine}>Across {standings.length} {standings.length === 1 ? "room" : "rooms"}. Tracking only. No money moves through this app.</Text>

      <Text style={styles.section}>Account</Text>
      <Button title="Privacy policy" variant="ghost" size="sm" onPress={() => Linking.openURL(PRIVACY_URL)} />
      <Button
        title="Sign out"
        variant="danger"
        onPress={() =>
          Alert.alert("Sign out?", undefined, [
            { text: "Cancel", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: () => signOut().catch(() => undefined) },
          ])
        }
        style={styles.gap}
      />

      <RGFooter />
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", paddingVertical: spacing.xl },
  handle: { color: colors.text, fontSize: fontSize.xl, fontWeight: "800", marginTop: spacing.md },
  section: {
    color: colors.muted,
    fontSize: fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowText: { flex: 1, marginRight: spacing.md },
  rowTitle: { color: colors.text, fontWeight: "600", fontSize: fontSize.md },
  rowSub: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
  quiet: { marginBottom: spacing.sm },
  quietLabel: { color: colors.muted, fontSize: fontSize.xs, marginBottom: spacing.xs },
  gapSm: { marginTop: spacing.sm },
  gap: { marginTop: spacing.md },
  statsGrid: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  stat: { flex: 1, alignItems: "center" },
  statValue: { color: colors.text, fontSize: fontSize.lg, fontWeight: "800", fontVariant: ["tabular-nums"] },
  statLabel: { color: colors.muted, fontSize: fontSize.xs, marginTop: 2 },
  fine: { color: colors.pending, fontSize: fontSize.xs, marginTop: spacing.sm },
});
