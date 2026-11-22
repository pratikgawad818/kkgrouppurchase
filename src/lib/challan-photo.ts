import { MAX_PROCUREMENT_ATTACHMENT_BYTES, validateProcurementAttachment, type AttachmentFileInfo } from "@/lib/procurement-attachments";

export const CHALLAN_PHOTO_ACCEPT = ".jpg,.jpeg,.png,image/jpeg,image/png";

/** A challan requires an actual photo, not a PDF or an arbitrary attachment. */
export function validateChallanPhoto(file: AttachmentFileInfo): void {
  const ext = validateProcurementAttachment(file);
  if (ext !== "jpg" && ext !== "jpeg" && ext !== "png")
    throw new Error("Take or select a JPG or PNG photo of the supplier challan.");
  if (file.size > MAX_PROCUREMENT_ATTACHMENT_BYTES)
    throw new Error("The challan photo must be 10 MB or smaller.");
}
