import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

export const ART_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CACHE = process.env.ART_CACHE ?? join(ART_ROOT, ".cache");

// Poly Haven and Overpass ask API clients to identify themselves.
export const USER_AGENT = "davis-digital-designs-art-pipeline/1.0 (portfolio build scripts)";

export function cachePath(...parts) {
  const p = join(CACHE, ...parts);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/** Download `url` to `dest` unless it already exists. Returns the path. */
export async function download(url, dest, { headers = {}, force = false } = {}) {
  if (!force && existsSync(dest) && statSync(dest).size > 0) return dest;
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
  if (!res.ok || !res.body) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return dest;
}

export async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

export function log(...args) {
  console.log("[fetch]", ...args);
}
