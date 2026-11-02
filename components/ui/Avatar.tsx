import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { colors } from "@/constants/theme";
import { initials } from "@/lib/format";

interface AvatarProps {
  handle: string | null | undefined;
  size?: number;
  style?: ViewStyle;
}

/** Initials avatar. avatar_url is in the schema but image avatars are not in v1. */
export function Avatar({ handle, size = 32, style }: AvatarProps) {
  const bg = hueFor(handle ?? "");
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
        style,
      ]}
    >
      <Text style={[styles.text, { fontSize: Math.max(10, size * 0.4) }]}>{initials(handle)}</Text>
    </View>
  );
}

interface AvatarStackProps {
  handles: string[];
  size?: number;
  max?: number;
}

export function AvatarStack({ handles, size = 24, max = 5 }: AvatarStackProps) {
  const shown = handles.slice(0, max);
  const extra = handles.length - shown.length;
  return (
    <View style={styles.stack}>
      {shown.map((h, i) => (
        <Avatar key={`${h}-${i}`} handle={h} size={size} style={i > 0 ? { marginLeft: -size / 3 } : undefined} />
      ))}
      {extra > 0 ? <Text style={styles.extra}>+{extra}</Text> : null}
    </View>
  );
}

/** Deterministic muted hue from the handle so avatars are stable across sessions. */
function hueFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 35%, 32%)`;
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  text: { color: colors.text, fontWeight: "700" },
  stack: { flexDirection: "row", alignItems: "center" },
  extra: { color: colors.muted, fontSize: 12, marginLeft: 6 },
});
