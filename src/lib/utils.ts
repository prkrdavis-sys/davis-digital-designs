export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = clamp((v - inMin) / (inMax - inMin), 0, 1);
  return lerp(outMin, outMax, t);
}

export function formatPrice(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}
