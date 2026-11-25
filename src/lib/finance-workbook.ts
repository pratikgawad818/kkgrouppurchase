/** Small, dependency-free OOXML writer for read-only finance exports.
 * Every text value is an inline string, never a formula or hyperlink.
 * Amounts remain numeric Excel cells. ZIP uses the standard STORE method.
 */
export type RegisterCell = string | number | null | undefined;
const encoder = new TextEncoder();
const xml = (value:string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,"")
  .replace(/_x[0-9a-fA-F]{4}_/g,m=>"_x005F_"+m.slice(1))
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const prolog='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ns="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pack="http://schemas.openxmlformats.org/package/2006/relationships";
function column(index:number):string {
  let name="";for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;
  return name;
}
const crcTable=Uint32Array.from({length:256},(_,i)=>{
  let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;
});
function crc32(bytes:Uint8Array){
  let c=0xffffffff;for(const b of bytes)c=(c>>>8)^crcTable[(c^b)&255]!;return (c^0xffffffff)>>>0;
}
function zipStore(files:Record<string,string>):Uint8Array<ArrayBuffer>{
  const chunks:Uint8Array[]=[];const directory:Uint8Array[]=[];let offset=0,centralSize=0;
  const entries=Object.entries(files);
  for(const [path,content] of entries){
    const name=encoder.encode(path),data=encoder.encode(content),crc=crc32(data);
    const local=new Uint8Array(30+name.length),l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);
    l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30);
    const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);
    c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);
    chunks.push(local,data);directory.push(central);offset+=local.length+data.length;centralSize+=central.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  const result=new Uint8Array(offset+centralSize+22);let cursor=0;
  for(const bytes of [...chunks,...directory,end]){result.set(bytes,cursor);cursor+=bytes.length;}
  return result;
}
export function financeWorkbook(headers:readonly string[],rows:readonly (readonly RegisterCell[])[]):Uint8Array<ArrayBuffer>{
  if(!headers.length||headers.length>40||rows.length>50000)throw new Error("Export exceeds supported register size; narrow your filters.");
  const last=column(headers.length-1)+(rows.length+1);
  const sheetRows=[headers,...rows].map((row,i)=>{
    if(row.length!==headers.length)throw new Error("Export column mismatch");
    const cells=row.map((value,j)=>{
      const address=column(j)+(i+1);
      if(typeof value==="number"){
        if(!Number.isFinite(value))throw new Error("Invalid financial amount; export stopped.");
        return '<c r="'+address+'" s="2"><v>'+value+'</v></c>';
      }
      const text=String(value??"");
      if(text.length>32767)throw new Error("A cell exceeds Excel's text limit.");
      return '<c r="'+address+'" t="inlineStr" s="'+(i===0?1:0)+'"><is><t xml:space="preserve">'+xml(text)+'</t></is></c>';
    }).join("");
    return '<row r="'+(i+1)+'">'+cells+'</row>';
  }).join("");
  const widths=headers.map((h,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+Math.max(16,Math.min(42,h.length+6))+'" customWidth="1"/>').join("");
  return zipStore({
    "[Content_Types].xml":prolog+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels":prolog+'<Relationships xmlns="'+pack+'"><Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":prolog+'<workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><sheets><sheet name="Register" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":prolog+'<Relationships xmlns="'+pack+'"><Relationship Id="rId1" Type="'+rel+'/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="'+rel+'/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml":prolog+'<styleSheet xmlns="'+ns+'"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF065B49"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    "xl/worksheets/sheet1.xml":prolog+'<worksheet xmlns="'+ns+'"><dimension ref="A1:'+last+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>'+widths+'</cols><sheetData>'+sheetRows+'</sheetData><autoFilter ref="A1:'+last+'"/></worksheet>',
  });
}
export function downloadFinanceWorkbook(name:string,headers:readonly string[],rows:readonly (readonly RegisterCell[])[]){
  const bytes=financeWorkbook(headers,rows);
  const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  const a=document.createElement("a");a.href=url;a.download=name.replace(/[^a-zA-Z0-9_.-]/g,"_")+".xlsx";
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
