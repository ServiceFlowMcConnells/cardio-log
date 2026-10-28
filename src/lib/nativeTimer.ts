// Bridge to the Android app's RestTimer plugin (native/overlay/java/RestTimerPlugin.java).
// Only present when Training Log is running inside the Android app.

export interface NativeRestTimer {
  start(o: { endAt: number; title: string; body: string; sound: boolean }): Promise<{ granted: boolean; exact?: boolean }>;
  cancel(): Promise<void>;
  requestPermission(): Promise<{ granted: boolean }>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  registerPlugin?: <T>(name: string) => T;
}

let cached: NativeRestTimer | null | undefined;

export function nativeRestTimer(): NativeRestTimer | null {
  if (cached !== undefined) return cached;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  cached = cap?.isNativePlatform?.() && cap.registerPlugin ? cap.registerPlugin<NativeRestTimer>("RestTimer") : null;
  return cached;
}

export const inAndroidApp = () => nativeRestTimer() != null;
