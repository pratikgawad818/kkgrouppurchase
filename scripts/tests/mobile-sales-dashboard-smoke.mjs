import {existsSync,readdirSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,copyFileSync} from "node:fs";
import {spawn,spawnSync} from "node:child_process";
import {resolve,join,extname} from "node:path";
import {tmpdir} from "node:os";
const out=resolve("artifacts/sales-dashboard-mobile"),temp=mkdtempSync(join(tmpdir(),"kk-sales-qa-"));
mkdirSync(out,{recursive:true});
function cssFiles(path,depth=7){if(!existsSync(path)||depth<1)return [];return readdirSync(path,{withFileTypes:true}).flatMap(d=>d.isFile()&&extname(d.name)===".css"?[join(path,d.name)]:d.isDirectory()&&!["node_modules","server","cache"].includes(d.name)?cssFiles(join(path,d.name),depth-1):[]);}
let server;
try{
 const built=spawnSync("bun",["build","scripts/tests/fixtures/mobile-sales-dashboard.tsx","--target","browser","--outdir",temp,"--minify"],{encoding:"utf8",timeout:90000});
 if(built.status!==0)throw Error(built.stderr);
 const js=readdirSync(temp).find(x=>x.endsWith(".js"));if(!js)throw Error("No dashboard fixture bundle");
 copyFileSync(join(temp,js),join(out,"app.js"));
 const css=[...new Set([".output/public",".output/client","dist","build"].flatMap(x=>cssFiles(x)))];if(!css.length)throw Error("Missing production CSS");
 writeFileSync(join(out,"app.css"),css.map(x=>readFileSync(x,"utf8")).join("\n"));
 writeFileSync(join(out,"fixture.html"),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>');
 const browser=["google-chrome","chromium","chromium-browser"].map(x=>spawnSync("which",[x],{encoding:"utf8"})).find(x=>x.status===0)?.stdout.trim();if(!browser)throw Error("Chrome required");
 const port=24000+process.pid%13000;
 server=spawn("python3",["-m","http.server",String(port),"--bind","127.0.0.1","--directory",out],{stdio:"ignore"});
 const url="http://127.0.0.1:"+port;
 const ready=spawnSync("curl",["--fail","--silent","--retry","12","--retry-connrefused","--retry-delay","1",url+"/fixture.html"],{encoding:"utf8",timeout:19000});if(ready.status!==0)throw Error("Fixture unavailable");
 for(const width of [360,390,430]){
  writeFileSync(join(out,"index.html"),'<!doctype html><style>body{margin:0}iframe{border:0;display:block;width:'+width+'px;height:844px}</style><iframe src="/fixture.html"></iframe><pre id="qa">pending</pre><script>const frame=document.querySelector("iframe");function check(){const d=frame.contentDocument;const root=d?.querySelector("[data-sales-dashboard-summary]");if(!root)return setTimeout(check,50);const w=frame.contentWindow;const cards=d.querySelector("[data-mobile-project-cards]");const charts=[...d.querySelectorAll("[data-mobile-trend]")];const allInside=[...root.querySelectorAll("section,article")].filter(x=>x.getClientRects().length).every(x=>x.getBoundingClientRect().right<=w.innerWidth+1);const before=charts[0]?.querySelector("select")?.value;const select=charts[0]?.querySelector("select");if(select){select.value=select.options[0].value;select.dispatchEvent(new w.Event("change",{bubbles:true}));}setTimeout(()=>{document.querySelector("#qa").textContent=JSON.stringify({width:w.innerWidth,docWidth:d.documentElement.scrollWidth,allInside,cards:w.getComputedStyle(cards).display!=="none",charts:charts.length,monthChanged:select?.value!==before});},100);}check();</script>');
  const r=spawnSync(browser,["--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage","--window-size=500,900","--virtual-time-budget=4000","--screenshot="+join(out,"dashboard-"+width+".png"),"--dump-dom",url+"/index.html"],{encoding:"utf8",timeout:60000,maxBuffer:4*1024*1024});
  const match=(r.stdout??"").match(/<pre id="qa">([^<]+)<\/pre>/);if(!match||match[1]==="pending")throw Error("Dashboard did not render at "+width);
  const a=JSON.parse(match[1]);if(a.width!==width||a.docWidth>width+1||!a.allInside||!a.cards||a.charts!==2||!a.monthChanged)throw Error("Mobile dashboard overflow/interaction regression "+JSON.stringify(a));
  console.log("PASS sales dashboard mobile",a);
 }
}finally{server?.kill();rmSync(temp,{recursive:true,force:true});}
