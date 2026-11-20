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
  // Chromium CLI has a 500 CSS-pixel window minimum. We smoke-test the
  // actual component and preserve built JS/CSS for independent real
  // 360/390/430px Playwright device-viewport visual inspection.
  try {
    const target = join(output, "director-expense-500.png");
    const chrome = spawnSync(browser, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--no-first-run", "--hide-scrollbars", "--window-size=500,844",
      "--virtual-time-budget=3000", "--screenshot=" + target, "--dump-dom",
      "http://127.0.0.1:" + port + "/index.html",
    ], { encoding: "utf8", timeout: 60000, maxBuffer: 6 * 1024 * 1024 });
    const match = (chrome.stdout ?? "").match(/<pre id="qa"[^>]*>([\s\S]*?)<\/pre>/);
    if (!match || match[1] === "pending")
      throw new Error("Expense viewer did not render in Chromium: " +
        (chrome.stderr ?? "").slice(-900) + (chrome.stdout ?? "").slice(-450));
    const data = JSON.parse(match[1]);
    if (
      data.error ||
      Math.abs(data.width - 500) > 3 ||
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
      throw new Error("Expense view smoke regression " + JSON.stringify(data));
    }
    console.log("PASS expense View Chromium smoke:", JSON.stringify(data));
  } finally {
    server.kill();
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
