import { supabase } from "@/integrations/supabase/client";

export const PROCUREMENT_ATTACHMENT_BUCKET = "procurement-attachments";
export const MAX_PROCUREMENT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ACCEPTED_MIME = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
} as const;

export const PROCUREMENT_ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

export type AttachmentFileInfo = Pick<File, "name" | "size" | "type">;

/** Validate before upload. Private bucket MIME/size restrictions also apply. */
export function validateProcurementAttachment(file: AttachmentFileInfo): string {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const expected = ACCEPTED_MIME[ext as keyof typeof ACCEPTED_MIME];
  if (!expected || file.type !== expected) {
    throw new Error("Select a PDF, JPG, JPEG or PNG file.");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 ||
      file.size > MAX_PROCUREMENT_ATTACHMENT_BYTES) {
    throw new Error("The attachment must be between 1 byte and 10 MB.");
  }
  return ext;
}

/**
 * Upload a new private immutable object. The company/user path is validated
 * by storage RLS; the database separately validates ownership before linking.
 */
export async function uploadProcurementAttachment(
  file: File,
  companyId: string,
  userId: string,
): Promise<string> {
  const ext = validateProcurementAttachment(file);
  if (!companyId || !userId) throw new Error("Sign in to upload documents.");
  const path = `${companyId}/${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(PROCUREMENT_ATTACHMENT_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
      cacheControl: "3600",
    });
  if (error) throw error;
  return path;
}

/** Filename extensions are created from validated MIME types, not URL input. */
export function procurementAttachmentContentType(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return ACCEPTED_MIME[ext as keyof typeof ACCEPTED_MIME] || "";
}
