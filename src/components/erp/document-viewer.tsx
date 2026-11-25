import { useEffect, useRef, useState } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { AlertCircle, ArrowLeft, Download, ExternalLink, Loader2, Minus, Plus, Printer, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ViewerDoc = {
  url: string;
  type: string;
  name: string;
  /** A4 page images avoid unsupported embedded-PDF plugins on Android. */
  pages?: string[];
  /** Used to prevent an async preview from reopening after Back is pressed. */
  previewId?: string;
  /** Cancels expensive work when the preview is dismissed or replaced. */
  controller?: AbortController;
  message?: string;
};
const EVENT = "erp:view-document";
const UPDATE = "erp:update-document";
const LOADING = "application/x-kk-po-loading";
const FAILED = "application/x-kk-po-error";

function revoke(doc: ViewerDoc | null) {
  if (!doc) return;
  for (const url of [doc.url, ...(doc.pages ?? [])]) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

export function showDocument(doc: ViewerDoc) {
  window.dispatchEvent(new CustomEvent<ViewerDoc>(EVENT, { detail: doc }));
}

/**
 * Display the viewer synchronously when View PO is tapped, then fill it when
 * the database and PDF render complete. Closing the viewer invalidates the
 * token, so late promises cannot reopen a dismissed preview.
 */
export function beginDocumentPreview(name: string) {
  const previewId = crypto.randomUUID();
  const controller = new AbortController();
  showDocument({ url: "", type: LOADING, name, previewId, controller });
  return {
    signal: controller.signal,
    show(file: Omit<ViewerDoc, "previewId" | "controller">) {
      if (controller.signal.aborted) { revoke(file); return; }
      window.dispatchEvent(new CustomEvent<ViewerDoc>(UPDATE, {
        detail: { ...file, previewId },
      }));
    },
    fail(message: string) {
      if (controller.signal.aborted) return;
      window.dispatchEvent(new CustomEvent<ViewerDoc>(UPDATE, {
        detail: { url: "", type: FAILED, name, message, previewId },
      }));
    },
  };
}

/** Full-screen in-app viewer for invoices and payment proofs. Mounted once in the root layout. */
export function DocumentViewer() {
  const [doc, setDoc] = useState<ViewerDoc | null>(null);
  const [pdfZoom, setPdfZoom] = useState(100);
  const iframe = useRef<HTMLIFrameElement>(null);
  const currentDoc = useRef<ViewerDoc | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setPdfZoom(100);
      const next = (e as CustomEvent<ViewerDoc>).detail;
      currentDoc.current?.controller?.abort();
      revoke(currentDoc.current);
      currentDoc.current = next;
      setDoc(next);
    };
    const onUpdate = (e: Event) => {
      const next = (e as CustomEvent<ViewerDoc>).detail;
      const previous = currentDoc.current;
      if (!previous || !previous.previewId || previous.previewId !== next.previewId) {
        revoke(next);
        return;
      }
      revoke(previous);
      const updated = { ...next, controller: previous.controller };
      currentDoc.current = updated;
      setDoc(updated);
    };
    window.addEventListener(EVENT, onOpen);
    window.addEventListener(UPDATE, onUpdate);
    return () => {
      window.removeEventListener(EVENT, onOpen);
      window.removeEventListener(UPDATE, onUpdate);
      currentDoc.current?.controller?.abort();
      revoke(currentDoc.current);
      currentDoc.current = null;
    };
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
    currentDoc.current?.controller?.abort();
    revoke(currentDoc.current);
    currentDoc.current = null;
    setDoc(null);
  }

  function printDocument() {
    if (!doc) return;
    if (doc.type === "application/pdf" && iframe.current?.contentWindow) {
      try {
        iframe.current.contentWindow.focus();
        iframe.current.contentWindow.print();
        return;
      } catch {
        // Some mobile PDF plugins cannot expose print across frame boundaries.
      }
    }
    // A temporary browser document lets images/PDFs print without printing
    // the underlying ERP screen; its source is already a local/private blob.
    const tab = window.open(doc.url, "_blank", "noopener,noreferrer");
    if (!tab) throw new Error("Allow pop-ups to print the document.");
  }

  if (!doc) return null;
  const loading = doc.type === LOADING;
  const failed = doc.type === FAILED;
  const isImage = doc.type.startsWith("image/");
  const isPdf = doc.type === "application/pdf";

  return (
    <div role="dialog" aria-modal="true" aria-label={`Viewing ${doc.name}`} className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <Button variant="ghost" size="sm" onClick={close} aria-label="Back">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={doc.name}>{doc.name}</p>
        {isPdf && (
          <div className="hidden items-center gap-0.5 sm:flex" aria-label="PDF zoom controls">
            <Button variant="ghost" size="icon" aria-label="Zoom PDF out"
              disabled={pdfZoom<=50} onClick={() => setPdfZoom(z=>Math.max(50,z-25))}>
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-10 text-center text-xs tabular-nums">{pdfZoom}%</span>
            <Button variant="ghost" size="icon" aria-label="Zoom PDF in"
              disabled={pdfZoom>=250} onClick={() => setPdfZoom(z=>Math.min(250,z+25))}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={printDocument} aria-label="Print document"
          disabled={loading || failed}>
          <Printer className="h-4 w-4" />
        </Button>
        {!loading && !failed && (
          <>
            <Button variant="ghost" size="icon" asChild aria-label="Download">
              <a href={doc.url} download={doc.name}><Download className="h-4 w-4" /></a>
            </Button>
            <Button variant="ghost" size="icon" asChild aria-label="Open in new tab">
              <a href={doc.url} target="_blank" rel="noopener"><ExternalLink className="h-4 w-4" /></a>
            </Button>
          </>
        )}
      </div>
      <div className="relative min-h-0 flex-1 bg-muted">
        {loading ? (
          <div role="status" className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Preparing document…</p>
            <p className="text-xs text-muted-foreground">Your PDF or image opens here automatically when ready.</p>
          </div>
        ) : failed ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h2 className="font-semibold">Could not open this document</h2>
            <p className="max-w-md text-sm text-muted-foreground">{doc.message || "The document could not be prepared."}</p>
            <Button type="button" variant="outline" onClick={close}>Go back</Button>
          </div>
        ) : isPdf && doc.pages?.length ? (
          <div className="h-full overflow-auto overscroll-contain p-2 sm:p-5"
            aria-label="Zoomable document pages">
            <div className="mx-auto flex flex-col items-center gap-4"
              style={{ width: pdfZoom + "%", maxWidth: (820 * pdfZoom / 100) + "px" }}>
              {doc.pages.map((url, index) => (
                <img key={url} src={url} alt={doc.name + ", page " + (index + 1)}
                  loading={index === 0 ? "eager" : "lazy"} decoding="async"
                  draggable={false}
                  className="h-auto w-full bg-white shadow-md ring-1 ring-black/10"
                  style={{ aspectRatio: "595.28 / 841.89" }} />
              ))}
              <p className="pb-6 text-xs text-muted-foreground">
                {doc.pages.length} page{doc.pages.length !== 1 ? "s" : ""} · Zoom with + / −
              </p>
            </div>
          </div>
        ) : isImage ? (
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
          <>
            <iframe ref={iframe} src={doc.url + "#zoom=" + pdfZoom} title={doc.name} className="h-full w-full border-0" />
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-lg sm:hidden">
              <Button variant="ghost" size="icon" aria-label="Zoom PDF out"
                disabled={pdfZoom<=50} onClick={() => setPdfZoom(z=>Math.max(50,z-25))}>
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center text-xs tabular-nums">{pdfZoom}%</span>
              <Button variant="ghost" size="icon" aria-label="Zoom PDF in"
                disabled={pdfZoom>=250} onClick={() => setPdfZoom(z=>Math.min(250,z+25))}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </>
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
