// Bridge to the Android app's RestTimer plugin (native/overlay/java/RestTimerPlugin.java).
// Only present when Training Log is running inside the Android app.
//
// The site is loaded live from Vercel, so it doesn't bundle @capacitor/core (which is where
// registerPlugin lives). The native bridge Capacitor injects into the page does provide
// Capacitor.nativePromise(plugin, method, options), so we call the plugin through that.

export interface NativeRestTimer {
  start(o: { endAt: number; title: string; body: string; sound: boolean }): Promise<{ granted: boolean; exact?: boolean }>;
  cancel(): Promise<void>;
  requestPermission(): Promise<{ granted: boolean }>;
}

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  nativePromise?: <T>(plugin: string, method: string, options?: unknown) => Promise<T>;
}

let cached: NativeRestTimer | null | undefined;

export function nativeRestTimer(): NativeRestTimer | null {
  if (cached !== undefined) return cached;
  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  if (!cap?.isNativePlatform?.() || !cap.nativePromise) return (cached = null);
  const call = <T,>(method: string, options: unknown = {}) => cap.nativePromise!<T>("RestTimer", method, options);
  cached = {
    start: (o) => call("start", o),
    cancel: () => call<void>("cancel"),
    requestPermission: () => call("requestPermission"),
  };
  return cached;
}

export const inAndroidApp = () => nativeRestTimer() != null;
