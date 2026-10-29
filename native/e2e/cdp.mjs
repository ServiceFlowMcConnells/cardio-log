// Runs JavaScript inside the app's WebView over Chrome DevTools (debug build), prints the results.
const [, , port = "9222"] = process.argv;
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === "page") ?? pages[0];
console.log("page:", page?.url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const run = (expression) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
const show = async (label, expr) => { const r = await run(expr); console.log(`${label}:`, JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r)); };

await show("bridge", `JSON.stringify({ href: location.href, cap: typeof window.Capacitor, native: window.Capacitor?.isNativePlatform?.(), platform: window.Capacitor?.getPlatform?.(), nativePromise: typeof window.Capacitor?.nativePromise, registerPlugin: typeof window.Capacitor?.registerPlugin })`);
await show("requestPermission", `Capacitor.nativePromise('RestTimer','requestPermission',{}).then(r => JSON.stringify(r)).catch(e => 'ERR ' + (e.message || e))`);
await show("start (whole-number endAt, as before the fix)", `Capacitor.nativePromise('RestTimer','start',{ endAt: Date.now() + 45000, title: 'Resting', body: 'whole number', sound: true }).then(r => JSON.stringify(r)).catch(e => 'ERR ' + (e.message || e))`);
await show("start (decimal endAt, as the fixed site sends)", `Capacitor.nativePromise('RestTimer','start',{ endAt: Math.floor(Date.now() + 45000) + 0.5, title: 'Resting', body: 'Next: Bench Press, set 2', sound: true }).then(r => JSON.stringify(r)).catch(e => 'ERR ' + (e.message || e))`);
ws.close();
