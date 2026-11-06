import { useEffect, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { ArrowLeft, Download, ExternalLink, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ViewerDoc = { url: string; type: string; name: string };
const EVENT = "erp:view-document";

export function showDocument(doc: ViewerDoc) {
  window.dispatchEvent(new CustomEvent<ViewerDoc>(EVENT, { detail: doc }));
}

/** Full-screen in-app viewer for invoices and payment proofs. Mounted once in the root layout. */
export function DocumentViewer() {
  const [doc, setDoc] = useState<ViewerDoc | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => setDoc((e as CustomEvent<ViewerDoc>).detail);
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  function close() {
    setDoc((d) => { if (d) URL.revokeObjectURL(d.url); return null; });
  }

  if (!doc) return null;
  const isImage = doc.type.startsWith("image/");
  const isPdf = doc.type === "application/pdf";

  return (
    <div role="dialog" aria-modal="true" aria-label={`Viewing ${doc.name}`} className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <Button variant="ghost" size="sm" onClick={close} aria-label="Back">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={doc.name}>{doc.name}</p>
        <Button variant="ghost" size="icon" asChild aria-label="Download">
          <a href={doc.url} download={doc.name}><Download className="h-4 w-4" /></a>
        </Button>
        <Button variant="ghost" size="icon" asChild aria-label="Open in new tab">
          <a href={doc.url} target="_blank" rel="noopener"><ExternalLink className="h-4 w-4" /></a>
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 bg-muted">
        {isImage ? (
          <TransformWrapper minScale={0.5} maxScale={8} centerOnInit wheel={{ step: 0.15 }} doubleClick={{ mode: "toggle" }}>
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <TransformComponent wrapperStyle={{ width: "100%", height: "100%", touchAction: "none" }} contentStyle={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <img src={doc.url} alt={doc.name} className="max-h-full max-w-full object-contain" />
                </TransformComponent>
                <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1 rounded-lg border bg-card p-1 shadow-md">
                  <Button variant="ghost" size="icon" onClick={() => zoomOut()} aria-label="Zoom out"><Minus className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => resetTransform()} aria-label="Reset zoom"><RotateCcw className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => zoomIn()} aria-label="Zoom in"><Plus className="h-4 w-4" /></Button>
                </div>
              </>
            )}
          </TransformWrapper>
        ) : isPdf ? (
          <iframe src={doc.url} title={doc.name} className="h-full w-full border-0" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
            <p>This file type can't be previewed here.</p>
            <Button asChild><a href={doc.url} download={doc.name}><Download className="h-4 w-4" /> Download file</a></Button>
          </div>
        )}
      </div>
    </div>
  );
}
