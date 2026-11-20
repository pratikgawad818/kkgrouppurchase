/**
 * Real React + built Tailwind mobile viewport smoke for Director expense View.
 * Runs in CI after `bun run build`; all fixture records are synthetic.
 * Exits nonzero if the expense viewer overflows, is obscured by the mobile
 * navigation, fails to scroll independently, or loses the Close action.
 */
import {
  existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync,
  mkdtempSync, rmSync, statSync, copyFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { resolve, join, extname, basename } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const output = resolve("artifacts", "expense-mobile-viewport");
mkdirSync(output, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "kk-expense-ui-"));

function scanCss(rootDir, limit = 7) {
  if (!existsSync(rootDir) || limit < 1) return [];
  const found = [];
  for (const d of readdirSync(rootDir, { withFileTypes: true })) {
    const filename = join(rootDir, d.name);
    if (d.isFile() && extname(d.name) === ".css") found.push(filename);
    else if (d.isDirectory() && !["node_modules", "server", "cache"].includes(d.name))
      found.push(...scanCss(filename, limit - 1));
  }
  return found;
}

try {
  const built = spawnSync("bun", [
    "build", "scripts/tests/fixtures/mobile-expense-detail.tsx",
    "--target", "browser", "--outdir", temp, "--minify",
  ], { encoding: "utf8", timeout: 90000 });
  if (built.status !== 0)
    throw new Error("Cannot bundle live expense detail component: " + built.stderr?.slice(-2500));
  const js = readdirSync(temp).find(file => file.endsWith(".js"));
  if (!js) throw new Error("Bun emitted no browser fixture JS");
  copyFileSync(join(temp, js), join(output, "app.js"));

  const cssPaths = [
    ...scanCss(".output/public"),
    ...scanCss(".output/client"),
    ...scanCss("dist"),
    ...scanCss("build"),
  ].sort((a, b) => statSync(b).size - statSync(a).size);
  if (!cssPaths.length)
    throw new Error("No Vite-built Tailwind CSS found; this is not a meaningful mobile UI test");
  // Client CSS may be split; include every emitted CSS chunk in the fixture.
  const css = [...new Set(cssPaths)].map(path => readFileSync(path, "utf8")).join("\n");
  if (!css.includes("overflow-y-auto") && !css.includes("overflow-y")) {
    throw new Error("Expected responsive Tailwind CSS utilities not present");
  }
  writeFileSync(join(output, "app.css"), css);
  const qaScript = `
    (function verify(){
      const panel=document.getElementById('expense-view-panel');
      const footer=panel?.querySelector('footer button');
      const scroll=panel?.querySelector('main');
      if(!panel||!footer||!scroll||document.body.style.overflow!=='hidden')
        return setTimeout(verify,50);
      const pr=panel.getBoundingClientRect(),fr=footer.getBoundingClientRect();
      const hr=panel.querySelector('header')?.getBoundingClientRect();
      const top=hr?.top??-1;
      const atBottom=document.elementFromPoint(
        Math.min(20,window.innerWidth-1),window.innerHeight-15
      );
      const navOnTop=atBottom?.closest('#fake-bottom-nav')!=null;
      const originalHeaderTop=hr?.top;
      scroll.scrollTop=scroll.scrollHeight;
      const fixedHeader=Math.abs((panel.querySelector('header')?.getBoundingClientRect().top??0)-(originalHeaderTop??0))<2;
      const result={
        width:window.innerWidth,height:window.innerHeight,
        panelLeft:pr.left,panelWidth:pr.width,
        panelHeight:pr.height,docWidth:document.documentElement.scrollWidth,
        footerBottom:fr.bottom,footerTop:fr.top,
        headerTop:top,footerVisible:fr.bottom<=window.innerHeight+3&&fr.top>window.innerHeight-180,
        fixedHeader,navOnTop,
        bodyLocked:document.body.style.overflow==='hidden',
        hasEditDelete:!!panel.querySelector('[aria-label*="Delete"],[aria-label*="Edit expense"]'),
        scrollable:scroll.scrollHeight>scroll.clientHeight,
      };
      // Capture a readable top-of-document screenshot after testing scroll.
      scroll.scrollTop=0;
      const out=document.getElementById('qa');
      out.textContent=JSON.stringify(result);
    })();
  `;
  writeFileSync(join(output, "index.html"),
    '<!doctype html><html lang="en"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Expense mobile viewport fixture</title><link rel="stylesheet" href="/app.css"></head>' +
    '<body><div id="root"></div><pre id="qa" hidden>pending</pre>' +
    '<script>window.addEventListener("error",e=>{document.getElementById("qa").textContent=' +
      'JSON.stringify({error:e.message,source:e.filename});});' +
      'window.addEventListener("unhandledrejection",e=>{document.getElementById("qa").textContent=' +
      'JSON.stringify({error:String(e.reason)});});</script>' +
    '<script type="module" src="/app.js"></script><script>' + qaScript + '</script>' +
    '</body></html>');

  const browserCheck = ["google-chrome", "chromium", "chromium-browser"]
    .map(x => spawnSync("which", [x], { encoding: "utf8" }))
    .find(x => x.status === 0);
  const browser = browserCheck?.stdout.trim();
  if (!browser) throw new Error("Headless Chromium required for mobile layout regression");
  const port = 25000 + (process.pid % 14000);
  const server = spawn("python3", [
    "-m", "http.server", String(port), "--bind", "127.0.0.1",
    "--directory", output,
  ], { stdio: "ignore" });
  const ready = spawnSync("curl", [
    "--fail", "--silent", "--show-error", "--retry", "12",
    "--retry-connrefused", "--retry-delay", "1",
    "http://127.0.0.1:" + port + "/index.html",
  ], { encoding: "utf8", timeout: 19000 });
  if (ready.status !== 0) {
    server.kill();
    throw new Error("Mobile smoke fixture HTTP server never became ready: " + ready.stderr);
  }
  // Chrome's --window-size has a 500 CSS-pixel minimum on Linux. Use the
  // DevTools device emulation protocol to actually test 360 / 390 / 430px.
  const debugPort = 39000 + (process.pid % 8000);
  const chrome = spawn(browser, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--no-first-run", "--hide-scrollbars", "--remote-allow-origins=*",
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=" + join(temp, "chrome-profile"),
    "about:blank",
  ], { stdio: "ignore" });
  let socket;
  try {
    let tabs;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:" + debugPort + "/json");
        if (response.ok) {
          tabs = await response.json();
          if (tabs.some(tab => tab.type === "page")) break;
        }
      } catch { /* Headless Chrome is still starting. */ }
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    const target = tabs?.find(tab => tab.type === "page");
    if (!target?.webSocketDebuggerUrl)
      throw new Error("Chrome DevTools mobile viewport target unavailable");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    let nextId = 0;
    const pending = new Map();
    socket.addEventListener("message", event => {
      const response = JSON.parse(String(event.data));
      if (!response.id || !pending.has(response.id)) return;
      const callback = pending.get(response.id);
      pending.delete(response.id);
      clearTimeout(callback.timer);
      if (response.error) callback.reject(new Error(response.error.message));
      else callback.resolve(response.result);
    });
    function command(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Chrome DevTools timeout: " + method));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    await command("Page.enable");
    await command("Runtime.enable");

    for (const width of [360, 390, 430]) {
      await command("Emulation.setDeviceMetricsOverride", {
        width, height: 844, deviceScaleFactor: 1, mobile: true,
        screenWidth: width, screenHeight: 844,
      });
      await command("Emulation.setTouchEmulationEnabled", {
        enabled: true, maxTouchPoints: 1,
      });
      await command("Page.navigate", {
        url: "http://127.0.0.1:" + port + "/index.html?v=" + width,
      });
      let data;
      for (let attempt = 0; attempt < 80; attempt++) {
        const result = await command("Runtime.evaluate", {
          expression: "(() => {try {const raw=document.getElementById('qa')?.textContent || 'pending';return raw==='pending'?null:JSON.parse(raw)}catch(e){return {error:String(e)}}})()",
          returnByValue: true,
        });
        data = result.result?.value;
        if (data) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!data) throw new Error("Viewport " + width + ": React viewer never rendered");
      if (data.error) throw new Error("Viewport " + width + ": browser JS error: " + data.error);
      if (
        Math.abs(data.width - width) > 2 ||
        Math.abs(data.panelLeft) > 2 ||
        data.panelWidth > data.width + 3 ||
        data.docWidth > data.width + 3 ||
        !data.footerVisible ||
        !data.fixedHeader ||
        data.navOnTop ||
        !data.bodyLocked ||
        data.hasEditDelete ||
        !data.scrollable
      ) {
        throw new Error("Viewport " + width + ": layout regression " + JSON.stringify(data));
      }
      const top = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
      writeFileSync(join(output, "director-expense-" + width + "-top.png"), Buffer.from(top.data, "base64"));
      await command("Runtime.evaluate", {
        expression: "document.querySelector('#expense-view-panel main').scrollTop=document.querySelector('#expense-view-panel main').scrollHeight",
      });
      await new Promise(resolve => setTimeout(resolve, 120));
      const bottom = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
      writeFileSync(join(output, "director-expense-" + width + "-bottom.png"), Buffer.from(bottom.data, "base64"));
      console.log("PASS actual mobile Director expense view " + width + "px:", JSON.stringify(data));
    }
  } finally {
    socket?.close();
    chrome.kill();
    server.kill();
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
