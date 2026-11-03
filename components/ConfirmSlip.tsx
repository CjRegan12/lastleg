import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Segmented";
import { T } from "@/components/ui/Text";
import { BET_TYPE_LABELS, BET_TYPES, BOOK_LABELS, BOOKS, MARKET_LABELS, MARKETS, SPORTS } from "@/constants/books";
import { colors, radius, spacing } from "@/constants/theme";
import { LOW_CONFIDENCE, type ParsedLeg, type ParsedSlip } from "@/lib/slips";

interface ConfirmSlipProps {
  value: ParsedSlip;
  onChange: (next: ParsedSlip) => void;
}

/**
 * Editable review of what parse-slip returned. Fields the model was unsure about
 * (confidence < 0.8) get an amber border; legs with no Propfein match are flagged.
 */
export function ConfirmSlip({ value, onChange }: ConfirmSlipProps) {
  const lowOverall = value.overall_confidence < LOW_CONFIDENCE;
  const set = <K extends keyof ParsedSlip>(key: K, v: ParsedSlip[K]) => onChange({ ...value, [key]: v });
  const setLeg = (i: number, patch: Partial<ParsedLeg>) => {
    const legs = value.legs.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    onChange({ ...value, legs });
  };

  return (
    <View>
      {lowOverall ? (
        <View style={styles.notice}>
          <T variant="small" color={colors.oneAway}>
            The parser was not confident about this slip. Check the amber fields before you submit.
          </T>
        </View>
      ) : null}

      <T variant="smallMedium" style={styles.label}>
        Book
      </T>
      <Segmented options={BOOKS} value={value.book} onChange={(b) => set("book", b)} labels={BOOK_LABELS} scrollable warn={lowOverall} />

      <T variant="smallMedium" style={[styles.label, styles.gap]}>
        Bet type
      </T>
      <Segmented
        options={BET_TYPES}
        value={value.bet_type}
        onChange={(b) => set("bet_type", b)}
        labels={BET_TYPE_LABELS}
        scrollable
        warn={lowOverall}
      />

      <View style={[styles.row, styles.gap]}>
        <NumberField
          label="Stake ($)"
          value={value.stake}
          onChange={(n) => set("stake", n ?? 0)}
          warn={lowOverall}
          style={styles.third}
        />
        <NumberField
          label="Odds"
          value={value.odds_american}
          onChange={(n) => set("odds_american", n ?? 0)}
          warn={lowOverall}
          integer
          signed
          style={styles.third}
        />
        <NumberField
          label="Payout ($)"
          value={value.potential_payout}
          onChange={(n) => set("potential_payout", n ?? 0)}
          warn={lowOverall}
          style={styles.third}
        />
      </View>

      <T variant="smallMedium" style={[styles.label, styles.gap]}>
        Legs ({value.legs.length})
      </T>
      {value.legs.map((leg, i) => {
        const low = leg.confidence < LOW_CONFIDENCE;
        const unmatched = leg.match === null;
        return (
          <View key={i} style={[styles.leg, unmatched && styles.legUnmatched]}>
            <View style={styles.row}>
              <T variant="heading" style={styles.legTitle}>
                Leg {i + 1}
              </T>
              {unmatched ? (
                <Badge label="No game matched" color={colors.oneAway} />
              ) : (
                <Badge label={`Matched ${Math.round((leg.match?.confidence ?? 0) * 100)}%`} color={colors.won} />
              )}
            </View>
            {unmatched ? (
              <T variant="small" color={colors.oneAway} style={styles.unmatchedNote}>
                This leg will not auto-grade. Anyone in the room can grade it by hand from the slip screen.
              </T>
            ) : null}

            <T variant="micro" style={styles.subLabel}>
              Sport
            </T>
            <Segmented options={SPORTS} value={leg.sport} onChange={(s) => setLeg(i, { sport: s })} scrollable warn={low} />
            <T variant="micro" style={[styles.subLabel, styles.gapSm]}>
              Market
            </T>
            <Segmented
              options={MARKETS}
              value={leg.market}
              onChange={(m) => setLeg(i, { market: m })}
              labels={MARKET_LABELS}
              scrollable
              warn={low}
            />
            <Input
              label="Selection"
              value={leg.selection}
              onChangeText={(t) => setLeg(i, { selection: t })}
              warn={low}
              containerStyle={styles.gapSm}
            />
            <View style={styles.row}>
              <NumberField
                label="Line"
                value={leg.line}
                onChange={(n) => setLeg(i, { line: n })}
                warn={low}
                signed
                style={styles.half}
              />
              <NumberField
                label="Leg odds"
                value={leg.leg_odds_american}
                onChange={(n) => setLeg(i, { leg_odds_american: n })}
                warn={low}
                integer
                signed
                style={styles.half}
              />
            </View>
            {leg.market === "player_prop" ? (
              <View style={styles.row}>
                <Input
                  label="Player"
                  value={leg.player_name ?? ""}
                  onChangeText={(t) => setLeg(i, { player_name: t || null })}
                  warn={low}
                  containerStyle={styles.half}
                />
                <Input
                  label="Stat"
                  placeholder="passing_yards"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={leg.stat_type ?? ""}
                  onChangeText={(t) => setLeg(i, { stat_type: t.trim().toLowerCase().replace(/\s+/g, "_") || null })}
                  warn={low}
                  containerStyle={styles.half}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  warn?: boolean;
  integer?: boolean;
  signed?: boolean;
  style?: ViewStyle;
}

const fmt = (n: number | null) => (n == null ? "" : String(n));

/** Text input that round-trips a number; keeps the raw text while typing so "-" and "12." work. */
function NumberField({ label, value, onChange, warn, integer, signed, style }: NumberFieldProps) {
  const [text, setText] = useState(fmt(value));
  const lastEmitted = useRef<number | null>(value);
  useEffect(() => {
    // parent replaced the value (new parse) rather than echoing our own edit
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(fmt(value));
    }
  }, [value]);

  return (
    <Input
      label={label}
      value={text}
      keyboardType={signed ? "numbers-and-punctuation" : "decimal-pad"}
      onChangeText={(t) => {
        const cleaned = t.replace(integer ? /[^\d+-]/g : /[^\d.+-]/g, "");
        setText(cleaned);
        const parsed = cleaned === "" || cleaned === "-" || cleaned === "+" ? null : Number(cleaned);
        const n = parsed == null || Number.isNaN(parsed) ? null : parsed;
        lastEmitted.current = n;
        onChange(n);
      }}
      warn={warn}
      containerStyle={style}
    />
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: `${colors.oneAway}1A`,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  label: { color: colors.muted, marginBottom: spacing.xs },
  subLabel: { marginBottom: spacing.xs, marginTop: spacing.sm },
  gap: { marginTop: spacing.lg },
  gapSm: { marginTop: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  third: { flex: 1 },
  half: { flex: 1 },
  leg: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  legUnmatched: { borderColor: colors.oneAway },
  legTitle: { flex: 1 },
  unmatchedNote: { marginTop: spacing.xs },
});
