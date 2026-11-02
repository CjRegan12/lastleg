/**
 * App entry.
 *
 * Release builds on the new architecture abort the process on any exception
 * thrown while the bundle is first evaluated (native RCTFatal, before the JS
 * global error handler can see it). Everything the app imports is loaded
 * inside the try below, and a failure registers a plain error screen instead,
 * so the message is readable on the device.
 */
/* global ErrorUtils */
const React = require("react");
const { AppRegistry, ScrollView, Text, View } = require("react-native");

function describe(error) {
  if (!error) return "Unknown error";
  const msg = error.message || String(error);
  const stack = error.stack ? String(error.stack).split("\n").slice(0, 12).join("\n") : "";
  return stack ? `${msg}\n\n${stack}` : msg;
}

function registerErrorScreen(title, text) {
  function StartupError() {
    return React.createElement(
      ScrollView,
      { style: { flex: 1, backgroundColor: "#0B0F14" }, contentContainerStyle: { padding: 24, paddingTop: 80 } },
      React.createElement(Text, { style: { color: "#F59E0B", fontSize: 18, fontWeight: "700", marginBottom: 12 } }, title),
      React.createElement(Text, { style: { color: "#E8EEF5", fontSize: 13, fontFamily: "Menlo", lineHeight: 18 } }, text),
    );
  }
  AppRegistry.registerComponent("main", () => StartupError);
}

// Runtime errors after startup: show instead of abort.
const utils = typeof ErrorUtils !== "undefined" ? ErrorUtils : global.ErrorUtils;
const previous = utils?.getGlobalHandler?.();
if (utils?.setGlobalHandler) {
  utils.setGlobalHandler((error, isFatal) => {
    const text = describe(error);
    // eslint-disable-next-line no-console
    console.error("[lastleg] global error", isFatal ? "(fatal)" : "", text);
    if (isFatal) {
      try {
        const { Alert } = require("react-native");
        setTimeout(() => Alert.alert("Last Leg hit an error", text), 0);
      } catch {}
      return;
    }
    previous?.(error, isFatal);
  });
}

// Load-time errors: catch and render.
try {
  require("expo-router/entry");
} catch (error) {
  // eslint-disable-next-line no-console
  console.error("[lastleg] failed to load app", error);
  registerErrorScreen("Last Leg failed to start", describe(error));
}
