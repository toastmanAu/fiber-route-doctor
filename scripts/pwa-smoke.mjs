// PWA build smoke test. Verifies apps/web/dist is a complete, installable,
// offline-capable PWA build. Run `npm run build -w apps/web` first.
// Usage: node scripts/pwa-smoke.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../apps/web/dist", import.meta.url).pathname;
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

if (!existsSync(dist)) {
  console.error(`FAIL dist not found at ${dist} — run: npm run build -w apps/web`);
  process.exit(1);
}

// --- Tier 1: mobile-correct index.html ---
const html = readFileSync(join(dist, "index.html"), "utf8");
check(/name="viewport"[^>]*width=device-width/.test(html), "index.html has viewport meta");
check(/name="theme-color"/.test(html), "index.html has theme-color meta");
check(/name="description"/.test(html), "index.html has description meta");
check(/rel="icon"/.test(html), "index.html links a favicon");
check(/rel="apple-touch-icon"/.test(html), "index.html links apple-touch-icon");
check(/rel="manifest"/.test(html), "index.html links the manifest");

// --- Tier 2: installable manifest + icons ---
const manifestPath = join(dist, "manifest.webmanifest");
check(existsSync(manifestPath), "manifest.webmanifest exists in dist");
if (existsSync(manifestPath)) {
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  check(typeof m.name === "string" && m.name.length > 0, "manifest has name");
  check(m.display === "standalone", "manifest display is standalone");
  check(m.start_url?.startsWith("/fiber-route-doctor/"), "manifest start_url under Pages base");
  check(m.scope?.startsWith("/fiber-route-doctor/"), "manifest scope under Pages base");
  check(typeof m.theme_color === "string", "manifest has theme_color");
  const sizes = new Set((m.icons ?? []).map((i) => i.sizes));
  check(sizes.has("192x192"), "manifest has 192x192 icon");
  check(sizes.has("512x512"), "manifest has 512x512 icon");
  check((m.icons ?? []).some((i) => i.purpose?.includes("maskable")), "manifest has maskable icon");
  for (const icon of m.icons ?? []) {
    check(existsSync(join(dist, icon.src)), `icon file present: ${icon.src}`);
  }
}

// --- Tier 3: service worker precaches the full offline demo ---
const swPath = join(dist, "sw.js");
check(existsSync(swPath), "sw.js exists in dist");
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, "utf8");
  const assets = readdirSync(join(dist, "assets"));
  const wasm = assets.find((f) => f.endsWith(".wasm"));
  const js = assets.find((f) => f.startsWith("index-") && f.endsWith(".js"));
  const css = assets.find((f) => f.endsWith(".css"));
  check(wasm && sw.includes(wasm), `sw precaches wasm bundle (${wasm ?? "missing"})`);
  check(js && sw.includes(js), `sw precaches app JS incl. demo snapshot (${js ?? "missing"})`);
  check(css && sw.includes(css), `sw precaches CSS (${css ?? "missing"})`);
  check(sw.includes("index.html"), "sw precaches index.html for offline navigation");
  const webps = assets.filter((f) => f.endsWith(".webp"));
  for (const w of webps) check(sw.includes(w), `sw precaches hero image ${w}`);
}

if (failures.length > 0) {
  console.error(`\nFAIL pwa-smoke: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nOK pwa-smoke: build is installable + offline-capable");
