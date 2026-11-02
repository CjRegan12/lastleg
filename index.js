/**
 * App entry.
 *
 * Render-phase errors are handled by the `ErrorBoundary` export in app/_layout.tsx
 * (the only mechanism that works for them on the new architecture). The global
 * handler below only covers async/non-render errors so they are logged rather
 * than silently swallowed.
 */
/* global ErrorUtils */
const utils = typeof ErrorUtils !== "undefined" ? ErrorUtils : global.ErrorUtils;
const previous = utils?.getGlobalHandler?.();
if (utils?.setGlobalHandler) {
  utils.setGlobalHandler((error, isFatal) => {
    // eslint-disable-next-line no-console
    console.error("[lastleg] global error", isFatal ? "(fatal)" : "", error?.message ?? error);
    previous?.(error, isFatal);
  });
}

require("expo-router/entry");
