// Runs JavaScript inside the app's WebView over Chrome DevTools (debug build). Usage: node cdp.mjs <port> <start|state>
const [, , port = "9222", mode = "start"] = process.argv;
// Wait for the app page (the live site inside the app) and for the native bridge to be ready
let page;
for (let i = 0; i < 30 && !page; i++) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json().catch(() => []);
  page = pages.find((p) => p.type === "page" && /vercel\.app/.test(p.url));
  if (!page) await new Promise((r) => setTimeout(r, 2000));
}
if (!page) { console.log("app page not found"); process.exit(0); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const run = (expression) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
const show = async (label, expr) => { const r = await run(expr); console.log(`${label}:`, JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r)); };
for (let i = 0; i < 30; i++) {
  const r = await run("typeof window.Capacitor?.nativePromise");
  if (r.result?.result?.value === "function") break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (mode === "health") {
  await show("health plugin", `String(Capacitor.isPluginAvailable?.('Health'))`);
  await show("health available", `Capacitor.nativePromise('Health','isAvailable',{}).then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message)`);
  await show("health check", `Capacitor.nativePromise('Health','checkAuthorization',{ read: ['steps','sleep'] }).then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message)`);
  await show("insets", `JSON.stringify({ top: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'), h1: document.querySelector('h1')?.getBoundingClientRect().top })`);
} else if (mode.startsWith("hyd-")) {
  // Water widget test helpers. HYD_JSON: the e2e-hydration "reset" response.
  const H = JSON.parse(process.env.HYD_JSON || "{}");
  if (mode === "hyd-web") {
    // Sign the web view in as the test account (its own session), then reload
    const key = `sb-${new URL(H.url).hostname.split(".")[0]}-auth-token`;
    await show("web session", `(localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(H.web_session))}), setTimeout(() => location.reload(), 200), 'set')`);
  } else if (mode === "hyd-session") {
    await show("plugin", `String(Capacitor.isPluginAvailable?.('Hydration'))`);
    await show("setSession", `Capacitor.nativePromise('Hydration','setSession',${JSON.stringify({ url: H.url, anonKey: H.anon_key, refreshToken: H.refresh_token, userId: H.user_id })}).then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message)`);
  } else if (mode === "hyd-pin") {
    await show("pinWidget", `Capacitor.nativePromise('Hydration','pinWidget',{}).then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message)`);
  } else {
    await show("widget state", `Capacitor.nativePromise('Hydration','getState',{}).then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message)`);
  }
} else if (mode === "start") {
  await show("permission", `Capacitor.nativePromise('RestTimer','requestPermission',{}).then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message)`);
  await show("start", `(window.__end = Math.floor(Date.now() + 90000) + 0.5, Capacitor.nativePromise('RestTimer','start',{ endAt: window.__end, title: 'Resting', body: 'Next: Bench Press, set 2', sound: true }).then(r => JSON.stringify(r)).catch(e => 'ERR ' + e.message))`);
} else {
  await show("state", `Capacitor.nativePromise('RestTimer','getState',{}).then(s => JSON.stringify({ ...s, secondsLeft: Math.round((s.endAt - Date.now()) / 1000), addedVsStart: Math.round((s.endAt - window.__end) / 1000) })).catch(e => 'ERR ' + e.message)`);
}
ws.close();
