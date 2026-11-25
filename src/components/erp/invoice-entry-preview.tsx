import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

/** Only preview the document the user selected on this form.
 * Never issue a storage URL or upload a file merely for previewing it. */
export function InvoiceEntryPreview({ file }: { file: File }) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const isPdf = file.type === "application/pdf";
  const isImage = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"].includes(file.type);
  useEffect(() => {
    if (!isPdf && !isImage) return;
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file, isPdf, isImage]);
  const url = preview?.file === file ? preview.url : undefined;
  return <aside aria-label="Selected invoice preview" className="order-first min-w-0 self-start rounded-xl border bg-card p-3 xl:order-none xl:sticky xl:top-4">
    <div className="mb-3 flex items-start gap-2">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
      <div className="min-w-0"><h2 className="font-semibold">Original bill preview</h2>
        <p className="break-all text-xs text-muted-foreground">{file.name}</p></div>
    </div>
    <p className="mb-3 text-xs text-muted-foreground">Compare the supplier document with your entries. This file stays on your device until you save the bill.</p>
    {url && isPdf ? <object data={url} type="application/pdf" aria-label="Invoice PDF preview" className="h-[65vh] w-full rounded-md border">
      <p className="p-3 text-xs text-muted-foreground">PDF preview is unavailable in this browser.</p>
    </object> : url && isImage ? <div className="max-h-[65vh] overflow-auto rounded-md border"><img src={url} alt="Selected supplier invoice" className="h-auto w-full object-contain"/></div> :
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Preview supports PDF and common raster image formats.</p>}
    {url && <a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-medium text-primary underline">Open document in separate tab</a>}
  </aside>;
}
