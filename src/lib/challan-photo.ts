export const CHALLAN_PHOTO_ACCEPT = ".jpg,.jpeg,.png,image/jpeg,image/png";
export const MAX_CHALLAN_PHOTO_BYTES = 10 * 1024 * 1024;

export type ChallanPhotoInfo = Pick<File, "name" | "size" | "type">;

/** Keep the form aligned with the private storage bucket's MIME and size limits. */
export function validateChallanPhoto(file: ChallanPhotoInfo): void {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!((ext === "jpg" || ext === "jpeg") && file.type === "image/jpeg") &&
      !(ext === "png" && file.type === "image/png")) {
    throw new Error("Take or select a JPG or PNG photo of the supplier challan.");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 ||
      file.size > MAX_CHALLAN_PHOTO_BYTES) {
    throw new Error("The challan photo must be between 1 byte and 10 MB.");
  }
}
