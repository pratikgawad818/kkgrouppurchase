import { useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { ArrowLeft, Download, Minus, Plus, Printer, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ViewerDoc = { url: string; type: string; name: string };
const EVENT = "erp:view-document";

/** The viewer uses an in-memory blob; no new route, file upload or permission bypass. */
export function showDocument(doc: ViewerDoc) {
  window.dispatchEvent(new CustomEvent<ViewerDoc>(EVENT, { detail: doc }));
}

/** In-screen document preview for private supplier evidence and buyer-issued POs. */
export function DocumentViewer() {
  const [doc, setDoc] = useState<ViewerDoc | null>(null);
  const [zoom, setZoom] = useState(100);
  const imageZoom = useRef<{ in: () => void; out: () => void; reset: () => void } | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const incoming = (e as CustomEvent<ViewerDoc>).detail;
      opener.current = document.activeElement as HTMLElement | null;
      setZoom(100);
      setDoc(previous => {
        if (previous?.url.startsWith("blob:") && previous.url !== incoming.url)
          URL.revokeObjectURL(previous.url);
        return incoming;
      });
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        // Keep keyboard users in the full-screen viewer.
        const nodes = Array.from(document.querySelectorAll<HTMLElement>(
          "[data-erp-doc-viewer] button:not([disabled]),[data-erp-doc-viewer] a[href]",
        ));
        if (!nodes.length) return;
        const first = nodes[0]!, last = nodes[nodes.length-1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();first.focus();
        }
      }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    backRef.current?.focus();
    window.addEventListener("keydown",onKey);
    return () => {
      window.removeEventListener("keydown",onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  function close() {
    setDoc(previous => {
      if (previous?.url.startsWith("blob:")) URL.revokeObjectURL(previous.url);
      return null;
    });
    const current = opener.current;
    if (current?.isConnected) current.focus();
    opener.current = null;
  }

  function download() {
    if (!doc) return;
    const link = document.createElement("a");
    link.href = doc.url;link.download = doc.name;
    document.body.appendChild(link);link.click();link.remove();
  }

  function print() {
    if (!doc) return;
    // Printing the main application would print a hidden PO instead of the
    // selected supplier quotation; isolate the selected document in an iframe.
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden","true");
    frame.style.cssText="position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
    if (doc.type === "application/pdf") frame.src = doc.url;
    else if (doc.type.startsWith("image/")) {
      frame.srcdoc = `<!doctype html><html><head><style>@page{margin:12mm}body{margin:0}img{display:block;max-width:100%;max-height:95vh;margin:auto}</style></head><body><img src="${doc.url}"></body></html>`;
    } else return;
    frame.onload = () => {
      try { frame.contentWindow?.focus();frame.contentWindow?.print(); }
      catch { /* browser privacy settings may block embedded print */ }
      // Preserve the iframe until the browser's print dialog closes.
    };
    document.body.appendChild(frame);
  }

  if (!doc) return null;
  const isImage = doc.type.startsWith("image/");
  const isPdf = doc.type === "application/pdf";
  const adjust = (by:number) => {
    setZoom(current => Math.min(250,Math.max(70,current+by)));
    if (isImage) {
      if (by>0) imageZoom.current?.in();
      else imageZoom.current?.out();
    }
  };

  return (
    <div data-erp-doc-viewer role="dialog" aria-modal="true"
      aria-label={`Viewing ${doc.name}`}
      className="fixed inset-0 z-[100] flex flex-col bg-background">
      <header className="shrink-0 border-b bg-card px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <Button ref={backRef} type="button" variant="outline" size="sm"
            onClick={close} aria-label="Back to Purchase Order" className="shrink-0">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={doc.name}>{doc.name}</p>
          <Button type="button" size="sm" variant="outline" onClick={print}
            aria-label="Print current document" className="gap-1">
            <Printer className="h-4 w-4" /> <span className="hidden sm:inline">Print</span>
          </Button>
          <Button type="button" size="sm" variant="default" onClick={download}
            aria-label="Download current document" className="gap-1">
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">Download</span>
          </Button>
        </div>
        {(isPdf || isImage) && (
          <div className="mt-2 flex items-center justify-center gap-2" aria-label="Document zoom controls">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8"
              onClick={() => adjust(-25)} disabled={zoom<=70} aria-label="Zoom out">
              <Minus className="h-4 w-4" />
            </Button>
            <span className="min-w-14 text-center text-xs tabular-nums">{zoom}%</span>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8"
              onClick={() => adjust(25)} disabled={zoom>=250} aria-label="Zoom in">
              <Plus className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8"
              onClick={() => {setZoom(100);imageZoom.current?.reset();}} aria-label="Reset zoom">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        )}
      </header>
      <main className="relative min-h-0 flex-1 overflow-auto bg-muted/40">
        {isImage ? (
          <TransformWrapper minScale={0.5} maxScale={8} centerOnInit
            wheel={{ step: 0.15 }} doubleClick={{ mode:"toggle" }}>
            {({zoomIn,zoomOut,resetTransform}) => {
              imageZoom.current = {in:()=>zoomIn(),out:()=>zoomOut(),reset:()=>resetTransform()};
              return (
                <TransformComponent
                  wrapperStyle={{width:"100%",height:"100%",touchAction:"none"}}
                  contentStyle={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <img src={doc.url} alt={doc.name} className="max-h-full max-w-full object-contain" />
                </TransformComponent>
              );
            }}
          </TransformWrapper>
        ) : isPdf ? (
          <div className="mx-auto h-full min-h-[450px] overflow-auto" style={{width:`${Math.max(100,zoom)}%`}}>
            <iframe src={doc.url} title={doc.name}
              className="h-full min-h-[450px] w-full border-0"
              style={{transform:zoom<100?`scale(${zoom/100})`:"none",transformOrigin:"top left"}} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
            <p>Preview not available for this file type.</p>
            <Button onClick={download}><Download className="mr-2 h-4 w-4" /> Download</Button>
          </div>
        )}
      </main>
    </div>
  );
}
