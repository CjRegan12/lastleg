import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from "react-native";

import { type } from "@/constants/theme";

export type TypeVariant = keyof typeof type;

interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  color?: string;
}

/** Typed text. Every Text in the app goes through here so the type scale holds. */
export function T({ variant = "body", color, style, ...rest }: TextProps) {
  return <RNText {...rest} style={[styles[variant], color ? { color } : null, style]} />;
}

const styles = StyleSheet.create(type);
