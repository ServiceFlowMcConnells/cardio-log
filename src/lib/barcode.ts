// Barcode reading from the camera. Uses the browser's own BarcodeDetector where it exists (Chrome on
// Android); otherwise loads a WebAssembly one (ZXing) from the CDN the first time it's needed.

type Detected = { rawValue: string; format: string };
export interface Detector { detect(source: CanvasImageSource): Promise<Detected[]> }

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const PONYFILL = "https://fastly.jsdelivr.net/npm/barcode-detector@3/dist/es/ponyfill.min.js";

let cached: Promise<Detector> | null = null;

export function getDetector(): Promise<Detector> {
  if (cached) return cached;
  cached = (async () => {
    const Native = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
    if (Native?.getSupportedFormats) {
      try {
        const have = await Native.getSupportedFormats();
        if (have.includes("ean_13")) return new Native({ formats: FORMATS.filter((f) => have.includes(f)) });
      } catch { /* fall through to the WebAssembly reader */ }
    }
    const url = PONYFILL;
    const mod = await import(/* @vite-ignore */ url);
    return new mod.BarcodeDetector({ formats: FORMATS }) as Detector;
  })().catch((e) => { cached = null; throw e; });
  return cached;
}

/** EAN/UPC check digit, so a misread doesn't look something up. */
export function validBarcode(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split("").map(Number);
  const check = d.pop()!;
  const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
