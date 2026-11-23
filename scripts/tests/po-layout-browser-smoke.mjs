/**
 * Headless browser smoke test for the actual PO canvas renderer.
 * Creates synthetic data only; never connects to the ERP database.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import ts from "typescript";

const output = resolve("artifacts", "po-layout-smoke");
mkdirSync(output, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "kk-po-"));
try {
  const compile = (source) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const taxSource = readFileSync("src/lib/po-commercial-summary.ts", "utf8")
    .replace(/^export /gm, "");
  const buyerSource = readFileSync("src/lib/po-buyer-identity.ts", "utf8")
    .replace(/^export /gm, "");
  const pdfSource = readFileSync("src/lib/po-pdf.ts", "utf8")
    .replace(/^import .*po-commercial-summary.*\r?\n/m, "")
    .replace(/^import .*po-buyer-identity.*\r?\n/m, "")
    .replace(/^export /gm, "");
  const po = {
    po_number: "PO-2026-0003", po_date: "2026-11-19",
    status: "pending_approval", approved_at: null,
    companies: { name: "K.K.CONSTRUCTION", legal_name: "K.K.CONSTRUCTION",
      registered_address: "Head Office :- Kacheri Road, Palghar, Maharashtra 401404",
      office_address: null, gstin: "27AALFK3094R1ZG", pan: "AALFK3094R",
      phone: "02525250081", email: "kkgroup1998@hotmail.com" },
    vendors: { company_name: "AXNOY Industries LLP",
      gstin: "27ABFFA0613F1Z0", address: "Supplier Office",
      city: "Mumbai", state: "Maharashtra", pincode: "400001",
      contact_person: null, mobile: null, email: null },
    warehouses: { name: "KK Park", address: "Opp. SDSM College" },
    projects: { name: "KK Park" }, buildings: { name: "General" },
    rfqs: { rfq_number: "RFQ-2026-0005" },
    purchase_requests: { pr_number: "PR-2026-0004" },
    vendor_quotations: {
      quotation_number: "AXN/PROJECT/NOV/ 2026 /KNG",
      quotation_date: "2026-11-19", payment_terms: "50% Advance 50% After Installation",
      remarks: null },
    subtotal: 29800, discount_total: 0, tax_total: 5994, grand_total: 39294,
    freight: 3500, other_charges: 0, freight_tax_type: "cgst_sgst",
    freight_tax_rate_percent: 18, freight_tax_amount: 630,
    other_charges_tax_type: "none", other_charges_tax_rate_percent: 0,
    other_charges_tax_amount: 0,
    payment_terms: "50% Advance 50% After Installation",
    delivery_terms: null, expected_delivery_date: "2026-11-22",
    remarks: null, prepared_by_name: "Site Staff", approved_by_name: null,
  };
  const items = [
    { line_no: 1, items: { name: "Axnoy Make Heavy Duty Speed Breakers of Size 400 x 500 x 50 mm Model Yellow/Black Color", code: "TWACXT" },
      units_of_measure: { code: "SQM" }, ordered_quantity: 20, rate: 1300,
      discount_amount: 0, taxable_amount: 26000, tax_type: "cgst_sgst",
      tax_rate_percent: 18, tax_amount: 4680, line_total: 30680 },
    { line_no: 2, items: { name: "Axnoy Make Heavy Duty End Caps of Size 180 x 400 x 50 mm Black Color", code: "WUVBFF" },
      units_of_measure: { code: "PCS" }, ordered_quantity: 8, rate: 475,
      discount_amount: 0, taxable_amount: 3800, tax_type: "cgst_sgst",
      tax_rate_percent: 18, tax_amount: 684, line_total: 4484 },
  ];
  const canvasShim = [
    "HTMLCanvasElement.prototype.toBlob = function(callback,type,quality) {",
    "  const encoded = this.toDataURL(type || 'image/jpeg', quality || 0.94);",
    "  const raw = atob(encoded.split(',')[1]);",
    "  const data = new Uint8Array(raw.length);",
    "  for(let i=0;i<raw.length;i++) data[i] = raw.charCodeAt(i);",
    "  callback(new Blob([data], {type:type || 'image/jpeg'}));",
    "};",
  ].join("\n");
  const runner = [
    "(async () => {",
    " const one = await buildPoReviewDocument(window.samplePO, window.sampleItems);",
    " if (one.previewPages.length !== 1) throw new Error('Reference PO should fit ONE A4 page; got ' + one.previewPages.length);",
    " const data = new Uint8Array(await one.pdf.arrayBuffer());",
    " if (new TextDecoder().decode(data.slice(0,8)) !== '%PDF-1.4') throw new Error('Invalid PDF');",
    " if (data.byteLength < 5000) throw new Error('PDF unexpectedly short');",
    " const longBuyer = {...window.samplePO, buyer_legal_entity_id:'synthetic-kanesa', buyer_legal_name:'KANESA EDIFICE PRIVATE LIMITED', buyer_gstin:'27AAJCK7799N1ZC', buyer_pan:'AAJCK7799N', buyer_billing_address:'Head Office - Kacheri Road, Palghar, Maharashtra 401404', buyer_phone:null,buyer_email:null, vendors:{company_name:'SANJARI TRADERS',address:null,city:null,state:null,pincode:null,gstin:null,contact_person:null,mobile:'9823428097',email:null}, projects:{name:'City Centre'},buildings:{name:'City Centre - C'},warehouses:{name:'CC - Main godown',address:'Opp CP-2'}};",
    " const longDocument = await buildPoReviewDocument(longBuyer,window.sampleItems);",
    " if (longDocument.previewPages.length !== 1) throw new Error('Long legal buyer should still fit ONE A4 page; got '+longDocument.previewPages.length);",
    " const longer = Array.from({length:30}, (_,i) => ({...window.sampleItems[i%2],line_no:i+1}));",
    " const many = await buildPoReviewDocument(window.samplePO,longer);",
    " if (many.previewPages.length < 2) throw new Error('Long PO was not paginated');",
    " const encode = async b => { const raw = new Uint8Array(await b.arrayBuffer());let out='';for(let i=0;i<raw.length;i+=8000) out+=String.fromCharCode(...raw.subarray(i,i+8000));return 'data:'+b.type+';base64,'+btoa(out);};",
    " document.getElementById('result').textContent = JSON.stringify({ok:true,pages:one.previewPages.length,",
    "   extended:many.previewPages.length,bytes:data.byteLength,",
    "   image:await encode(one.previewPages[0]),pdf:await encode(one.pdf),",
    "   longImage:await encode(longDocument.previewPages[0]),longPdf:await encode(longDocument.pdf)});",
    "})().catch(error => {document.getElementById('result').textContent = JSON.stringify({ok:false,error:String(error.stack||error)});});",
  ].join("\n");
  writeFileSync(join(work, "app.js"), canvasShim + "\n" + compile(taxSource) + "\n" + compile(buyerSource) + "\n" + compile(pdfSource) +
    "\nwindow.samplePO=" + JSON.stringify(po) + ";\nwindow.sampleItems=" +
    JSON.stringify(items) + ";\n" + runner);
  writeFileSync(join(work, "index.html"), '<!doctype html><meta charset="utf-8">' +
    '<pre id="result">pending</pre>' +
    '<script>window.addEventListener("error",e=>{document.getElementById("result").textContent=' +
      'JSON.stringify({ok:false,error:"JS: "+e.message+" at "+e.filename+":"+e.lineno});});' +
    'window.addEventListener("unhandledrejection",e=>{document.getElementById("result").textContent=' +
      'JSON.stringify({ok:false,error:String(e.reason)});});</script>' +
    '<script>' + readFileSync(join(work, "app.js"), "utf8") + '</script>');

  const browser = [process.env.CHROME_BIN, "google-chrome", "chromium", "chromium-browser"]
    .filter(Boolean).map(name => spawnSync("which", [name], { encoding: "utf8" }))
    .find(result => result.status === 0)?.stdout.trim();
  if (!browser) throw new Error("Chrome/Chromium is required to verify A4 PDF rendering.");
  // Serving from localhost avoids file:// script/canvas security and
  // scheduling differences between Ubuntu Chrome versions.
  const port = 24000 + (process.pid % 18000);
  const serverCode = "require('node:http').createServer((req,res)=>{" +
    "res.setHeader('Content-Type','text/html; charset=utf-8');" +
    "res.end(require('node:fs').readFileSync(process.argv[1]));" +
    "}).listen(" + port + ",'127.0.0.1');";
  const server = spawn(process.execPath, ["-e", serverCode, join(work, "index.html")], {
    stdio: "ignore",
  });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
  // Chrome --dump-dom sometimes snapshots the page while the async PDF
  // canvas worker is still pending. Retrying *only* that incomplete snapshot
  // avoids unrelated CI flakes without suppressing a real renderer failure.
  let run;
  let match;
  try {
    for (const budget of [12000, 45000, 120000]) {
      run = spawnSync(browser, [
        "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
        "--no-first-run", "--disable-extensions", "--virtual-time-budget=" + budget,
        "--dump-dom", "http://127.0.0.1:" + port + "/",
      ], { encoding: "utf8", timeout: 90000, maxBuffer: 20 * 1024 * 1024 });
      match = (run.stdout || "").match(/<pre id="result">([\s\S]*?)<\/pre>/);
      if (match && match[1] !== "pending") break;
      console.warn("Chrome rendered a pending PO PDF snapshot; retrying with longer virtual time budget", budget);
    }
  } finally {
    server.kill();
  }
  if (!match || match[1] === "pending") {
    throw new Error("PDF renderer did not finish after browser retries. Chrome: " +
      run?.stderr?.slice(-2500) + " DOM: " + run?.stdout?.slice(-700));
  }
  const result = JSON.parse(match[1]);
  if (!result.ok) throw new Error(result.error);
  writeFileSync(join(output, "po-reference.jpg"), Buffer.from(result.image.split(",")[1], "base64"));
  writeFileSync(join(output, "po-reference.pdf"), Buffer.from(result.pdf.split(",")[1], "base64"));
  writeFileSync(join(output, "po-long-legal-buyer.jpg"), Buffer.from(result.longImage.split(",")[1], "base64"));
  writeFileSync(join(output, "po-long-legal-buyer.pdf"), Buffer.from(result.longPdf.split(",")[1], "base64"));
  console.log("PASS real A4 PDF browser test:", {
    onePageReference: result.pages,
    longOrderPages: result.extended,
    pdfBytes: result.bytes,
    visualPreview: "artifacts/po-layout-smoke/po-reference.jpg",
    longBuyerPreview: "artifacts/po-layout-smoke/po-long-legal-buyer.jpg",
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
