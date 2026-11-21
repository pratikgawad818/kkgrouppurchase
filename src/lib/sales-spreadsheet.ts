/** Browser-only import/export of the flat master. No external spreadsheet SDK.
 * .xlsx: first worksheet in OOXML. Older .xls requires Excel's Save As CSV.
 * Server independently validates every imported row before writing anything.
 */
export const SALES_HEADERS = [
  "floor_number","flat_number","type","carpet_area","built_up_area",
  "saleable_area","rate","parking","other","gst",
] as const;
export type SalesRow = Record<(typeof SALES_HEADERS)[number], string>;
const MAX_FILE_BYTES = 10*1024*1024;
const MAX_ROWS = 300;
const safeCsvCell = (value: unknown) => {
  let text=String(value??"");
  if (/^\s*[=+@\t\r]/.test(text) || /^\s*-[^0-9]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};
export function csvExport(rows: readonly (readonly unknown[])[]): string {
  return "\uFEFF"+rows.map(row=>row.map(safeCsvCell).join(",")).join("\r\n")+"\r\n";
}
export function downloadCsv(name:string, rows:readonly (readonly unknown[])[]) {
  const url=URL.createObjectURL(new Blob([csvExport(rows)],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function parseCsv(text:string): string[][] {
  const output:string[][]=[];let row:string[]=[];let field="";let quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"' && text[i+1]==='"'){field+='"';i++;}
      else if(c==='"')quoted=false;
      else field+=c;
    }else if(c==='"'){
      if(field.length)throw new Error("Unexpected quote in CSV");
      quoted=true;
    }else if(c===","){row.push(field.trim());field="";}
    else if(c==="\r"||c==="\n"){
      if(c==="\r"&&text[i+1]==="\n")i++;
      row.push(field.trim());
      if(row.some(x=>x))output.push(row);
      if(output.length>MAX_ROWS+2)throw new Error("Import at most 300 flat rows at a time");
      row=[];field="";
    }else field+=c;
  }
  if(quoted)throw new Error("Unclosed quoted field in CSV");
  row.push(field.trim());
  if(row.some(x=>x))output.push(row);
  return output;
}
function fromGrid(grid:string[][]):SalesRow[]{
  const header=grid[0];
  if(!header)throw new Error("The spreadsheet is empty");
  const normalized=(s:string)=>s.toLowerCase().trim().replaceAll(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
  const h=header.map(normalized),mapping=SALES_HEADERS.map(key=>h.indexOf(key));
  if(mapping.some(index=>index<0)){
    const missing=SALES_HEADERS.filter((_,i)=>mapping[i]<0);
    throw new Error("Missing spreadsheet columns: "+missing.join(", "));
  }
  const rows=grid.slice(1).filter(row=>row.some(x=>x.trim()!==""));
  if(!rows.length||rows.length>MAX_ROWS)throw new Error("Enter 1 to 300 flats per upload");
  return rows.map((line,index)=>{
    const row={} as SalesRow;
    SALES_HEADERS.forEach((key,i)=>{
      const v=line[mapping[i]??-1]??"";
      row[key]=v.trim();
    });
    if(!/^[-]?\d{1,3}$/.test(row.floor_number))throw new Error(`Row ${index+2}: floor number must be numeric`);
    if(!row.flat_number || row.flat_number.length>50)throw new Error(`Row ${index+2}: flat number is required`);
    for(const key of ["carpet_area","built_up_area","saleable_area","rate"] as const){
      if(!/^\d{1,10}(\.\d{1,3})?$/.test(row[key])||Number(row[key])<=0)
        throw new Error(`Row ${index+2}: invalid ${key}`);
    }
    row.parking ||= "0";row.other ||= "0";row.gst ||= "5";
    return row;
  });
}
const read16=(v:DataView,n:number)=>v.getUint16(n,true);
const read32=(v:DataView,n:number)=>v.getUint32(n,true);
const utf8=new TextDecoder();
type ZipEntry={offset:number;size:number;method:number;unpacked:number};
async function unzipXml(buffer:ArrayBuffer):Promise<Map<string,string>>{
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(read32(view,i)===0x06054b50){end=i;break;}
  }
  if(end<0)throw new Error("Excel .xlsx ZIP directory not found");
  const count=read16(view,end+10);let pos=read32(view,end+16);
  if(count>500)throw new Error("Excel workbook has too many ZIP entries");
  const selected=new Map<string,ZipEntry>();
  for(let i=0;i<count;i++){
    if(pos+46>bytes.length||read32(view,pos)!==0x02014b50)throw new Error("Invalid Excel ZIP directory");
    const method=read16(view,pos+10),size=read32(view,pos+20),unpacked=read32(view,pos+24);
    const nameLen=read16(view,pos+28),extra=read16(view,pos+30),comment=read16(view,pos+32);
    const name=utf8.decode(bytes.subarray(pos+46,pos+46+nameLen));
    const offset=read32(view,pos+42);
    if((name==="xl/sharedStrings.xml"||/^xl\/worksheets\/sheet[0-9]+\.xml$/.test(name)) && unpacked<=8*1024*1024)
      selected.set(name,{offset,size,method,unpacked});
    pos+=46+nameLen+extra+comment;
  }
  const sheet=Array.from(selected.keys()).filter(x=>x.startsWith("xl/worksheets/"))
    .sort((a,b)=>Number(a.match(/sheet(\d+)/)?.[1])-Number(b.match(/sheet(\d+)/)?.[1]))[0];
  if(!sheet)throw new Error("No supported Excel worksheet found");
  const result=new Map<string,string>();
  for(const name of [sheet,"xl/sharedStrings.xml"]){
    const entry=selected.get(name);if(!entry)continue;
    const p=entry.offset;
    if(p+30>bytes.length||read32(view,p)!==0x04034b50)throw new Error("Invalid Excel ZIP header");
    const start=p+30+read16(view,p+26)+read16(view,p+28);
    if(start+entry.size>bytes.length)throw new Error("Truncated Excel file");
    const compressed=bytes.slice(start,start+entry.size);
    let raw:Uint8Array;
    if(entry.method===0)raw=compressed;
    else if(entry.method===8){
      if(typeof DecompressionStream==="undefined")throw new Error("Browser cannot extract .xlsx; save the sheet as CSV");
      const stream=new Blob([compressed]).stream().pipeThrough(
        new DecompressionStream("deflate-raw" as CompressionFormat));
      const reader=stream.getReader(),chunks:Uint8Array[]=[];let total=0;
      while(true){
        const next=await reader.read();if(next.done)break;
        const chunk=next.value as Uint8Array;total+=chunk.byteLength;
        if(total>8*1024*1024){await reader.cancel();throw new Error("Excel worksheet is too large");}
        chunks.push(chunk);
      }
      raw=new Uint8Array(total);let cursor=0;
      for(const chunk of chunks){raw.set(chunk,cursor);cursor+=chunk.length;}
    }else throw new Error("Unsupported Excel compression");
    result.set(name,utf8.decode(raw));
  }
  return result;
}
function parseXlsxXml(xml:Map<string,string>):string[][]{
  const sheetPath=[...xml.keys()].find(x=>x.startsWith("xl/worksheets/"));
  if(!sheetPath)throw new Error("Missing Excel worksheet");
  const parser=new DOMParser();
  const doc=(text:string)=>{const out=parser.parseFromString(text,"application/xml");
    if(out.querySelector("parsererror"))throw new Error("Excel XML is malformed");return out;};
  const shared=xml.get("xl/sharedStrings.xml");
  const strings=shared?[...doc(shared).getElementsByTagName("si")].map(si=>si.textContent??""):[];
  const ws=doc(xml.get(sheetPath)??"");
  const result:string[][]=[];
  for(const row of Array.from(ws.getElementsByTagName("row")).slice(0,MAX_ROWS+2)){
    const values:string[]=[];
    for(const c of Array.from(row.getElementsByTagName("c"))){
      const ref=c.getAttribute("r")??"";
      const name=ref.match(/^[A-Z]+/)?.[0]??"";
      let col=0;for(const ch of name)col=col*26+ch.charCodeAt(0)-64;
      if(col<1||col>40)continue;
      const raw=c.getElementsByTagName("v")[0]?.textContent??"";
      const type=c.getAttribute("t");
      values[col-1]=type==="s"?(strings[Number(raw)]??""):
        type==="inlineStr"?(c.getElementsByTagName("is")[0]?.textContent??""):raw;
    }
    if(values.some(x=>x?.trim()))result.push(values.map(x=>x??""));
  }
  return result;
}
export async function readFlatSpreadsheet(file:File):Promise<SalesRow[]>{
  if(file.size<1||file.size>MAX_FILE_BYTES)throw new Error("File must be below 10 MB");
  const ext=file.name.toLowerCase().split(".").pop();
  if(ext==="csv")return fromGrid(parseCsv((await file.text()).replace(/^\uFEFF/,"")));
  if(ext==="xlsx")return fromGrid(parseXlsxXml(await unzipXml(await file.arrayBuffer())));
  throw new Error("Use .csv or .xlsx. Convert old .xls files using Excel's Save As CSV.");
}
