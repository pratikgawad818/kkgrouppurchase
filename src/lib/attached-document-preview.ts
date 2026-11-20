import { supabase } from "@/integrations/supabase/client";
import { beginDocumentPreview } from "@/components/erp/document-viewer";
import {
  PROCUREMENT_ATTACHMENT_BUCKET,
  procurementAttachmentContentType,
} from "@/lib/procurement-attachments";

/**
 * The private supplier PDF stays on the signed-in user's device. Mozilla
 * PDF.js is bundled with the app; no third-party preview service receives it.
 * A rendered page is displayed as an image so Android/Chrome PDF-plugin
 * support is not required for viewing/zooming.
 */
async function renderPrivatePdfPages(blob: Blob): Promise<Blob[]> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false,
  });
  const pages: Blob[] = [];
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1) throw new Error("The quotation PDF has no pages.");
    // Small, uploaded supplier quotations are normally 1–10 pages. Bound
    // resource use for untrusted PDFs before allocating large canvases.
    if (pdf.numPages > 60) {
      throw new Error("This quotation has more than 60 pages. Use Download to read the original PDF.");
    }
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(1.8, 1700 / original.height, 1600 / original.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("The browser cannot display this quotation PDF.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const rendered = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error("Could not render quotation page " + number)),
          "image/jpeg", 0.88,
        ));
      pages.push(rendered);
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Opens synchronously on tap and returns the asynchronous download/render work.
 * Callers should catch rejected promises to surface user-friendly feedback.
 * The viewer safely ignores late completion after Back and reclaims object URLs.
 */
export function openPrivateProcurementAttachment(path: string, label: string): Promise<void> {
  const preview = beginDocumentPreview(label);
  return (async () => {
    let fileUrl: string | null = null;
    let pageUrls: string[] = [];
    try {
      const mime = procurementAttachmentContentType(path);
      if (!mime) throw new Error("Unsupported document type. Upload a PDF, JPG or PNG.");
      const { data, error } = await supabase.storage.from(PROCUREMENT_ATTACHMENT_BUCKET).download(path);
      if (error) throw error;
      if (!data || !data.size) throw new Error("The attached quotation file is empty or unavailable.");

      const file = new Blob([data], { type: mime });
      fileUrl = URL.createObjectURL(file);
      if (mime === "application/pdf") {
        const pages = await renderPrivatePdfPages(file);
        pageUrls = pages.map(page => URL.createObjectURL(page));
      }
      preview.show({
        url: fileUrl,
        pages: pageUrls.length ? pageUrls : undefined,
        type: mime,
        name: label,
      });
      fileUrl = null; // viewer now owns URLs and revokes them when dismissed
      pageUrls = [];
    } catch (error) {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      for (const pageUrl of pageUrls) URL.revokeObjectURL(pageUrl);
      const message = error instanceof Error ? error.message : "Quotation could not be opened.";
      preview.fail(message);
      throw error;
    }
  })();
}
