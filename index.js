/**
 * App entry. Installs a global JS error handler BEFORE Expo Router loads so a
 * fatal error at startup shows its message on screen instead of aborting the
 * process with no UI (React Native's default release behaviour is to throw an
 * NSException from reportFatalException, which is an instant SIGABRT).
 *
 * The last fatal is also stored so the next launch can surface it.
 */
/* global ErrorUtils */
const utils = typeof ErrorUtils !== "undefined" ? ErrorUtils : global.ErrorUtils;
const previous = utils?.getGlobalHandler?.();

function describe(error) {
  if (!error) return "Unknown error";
  const msg = error.message || String(error);
  const stack = error.stack ? String(error.stack).split("\n").slice(0, 6).join("\n") : "";
  return stack ? `${msg}\n\n${stack}` : msg;
}

if (utils?.setGlobalHandler) {
  utils.setGlobalHandler((error, isFatal) => {
    const text = describe(error);
    try {
      // Lazy require: AsyncStorage may itself be the thing that failed.
      const AsyncStorage = require("@react-native-async-storage/async-storage").default;
      AsyncStorage.setItem("lastleg:lastFatal", `${new Date().toISOString()}\n${text}`).catch(() => {});
    } catch {}
    // eslint-disable-next-line no-console
    console.error("[lastleg] global error", isFatal ? "(fatal)" : "", text);
    if (isFatal) {
      try {
        const { Alert } = require("react-native");
        setTimeout(() => Alert.alert("Last Leg hit an error at startup", text), 0);
      } catch {}
      return; // swallow: keep the process alive so the message can be read
    }
    previous?.(error, isFatal);
  });
}

require("expo-router/entry");
