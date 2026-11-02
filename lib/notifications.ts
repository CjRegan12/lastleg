import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushRegistration =
  | { ok: true; token: string }
  | { ok: false; reason: "denied" | "no_project_id" | "simulator" | "error"; error?: unknown };

/**
 * Ask for permission, fetch the Expo push token and save it to profiles.push_token.
 * Safe to call repeatedly (e.g. from a settings toggle).
 */
export async function registerForPushAsync(userId: string): Promise<PushRegistration> {
  if (!Constants.isDevice) return { ok: false, reason: "simulator" };

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== "granted") return { ok: false, reason: "denied" };

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId || projectId.startsWith("REPLACE_")) return { ok: false, reason: "no_project_id" };

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { error } = await supabase.from("profiles").update({ push_token: token }).eq("id", userId);
    if (error) return { ok: false, reason: "error", error };
    return { ok: true, token };
  } catch (error) {
    return { ok: false, reason: "error", error };
  }
}

export async function clearPushToken(userId: string): Promise<void> {
  await supabase.from("profiles").update({ push_token: null }).eq("id", userId);
}

export async function hasPushPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}

function urlFromResponse(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as { url?: unknown } | undefined;
  return typeof data?.url === "string" ? data.url : null;
}

/**
 * Expo Router deep-link pattern for notifications: handle the tap that launched
 * the app, then listen for taps while running. `notifications.url` from the
 * server is an in-app route like "/rooms/<id>".
 */
export function useNotificationDeepLinks(enabled: boolean): void {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    function redirect(response: Notifications.NotificationResponse | null) {
      const url = urlFromResponse(response);
      if (url && !cancelled) {
        router.push(url as never);
      }
    }

    const last = Notifications.getLastNotificationResponse();
    if (last) {
      redirect(last);
      Notifications.clearLastNotificationResponse();
    }

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      redirect(response);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [enabled, router]);
}
