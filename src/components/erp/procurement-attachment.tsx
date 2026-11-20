import { useState } from "react";
import { FileText, Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openPrivateProcurementAttachment } from "@/lib/attached-document-preview";
import { supabase } from "@/integrations/supabase/client";
import {
  PROCUREMENT_ATTACHMENT_ACCEPT,
  validateProcurementAttachment,
} from "@/lib/procurement-attachments";

export function ProcurementAttachmentLink({
  path,
  label = "View attached quotation",
}: {
  path?: string | null;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  if (!path) return null;

  async function view() {
    setLoading(true);
    try {
      await openPrivateProcurementAttachment(path!, label);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open attachment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={loading}
      onClick={() => void view()}>
      <FileText className="mr-1 h-4 w-4" aria-hidden="true" />
      {loading ? "Opening…" : label}
    </Button>
  );
}

export function ProcurementAttachmentInput({
  file,
  setFile,
  existingPath,
  label = "Quotation / supporting document (optional)",
}: {
  file: File | null;
  setFile: (next: File | null) => void;
  existingPath?: string | null | undefined;
  label?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-3" aria-label={label}>
      <label className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        {label}
      </label>
      <p className="my-1 text-xs text-muted-foreground">
        PDF, JPG or PNG, maximum 10 MB. Files are private and visible only to
        authorized project reviewers. Selecting a new file replaces the active attachment.
      </p>
      <input type="file" accept={PROCUREMENT_ATTACHMENT_ACCEPT}
        aria-label={label}
        className="mt-2 block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-2 file:text-sm"
        onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          if (next) {
            try {
              validateProcurementAttachment(next);
            } catch (error) {
              event.target.value = "";
              toast.error(error instanceof Error ? error.message : "Invalid attachment");
              setFile(null);
              return;
            }
          }
          setFile(next);
        }}
      />
      {file && <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
        Selected: {file.name}. It will upload when you save.
      </p>}
      {existingPath && (
        <div className="mt-2">
          <ProcurementAttachmentLink path={existingPath} label="View current attachment" />
        </div>
      )}
    </section>
  );
}
