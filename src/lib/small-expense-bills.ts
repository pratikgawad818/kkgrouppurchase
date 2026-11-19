import { supabase } from "@/integrations/supabase/client";
import { showDocument } from "@/components/erp/document-viewer";

export const SMALL_EXPENSE_BILL_BUCKET = "small-expense-bills";
export const SMALL_EXPENSE_MAX_BILLS = 8;
export const SMALL_EXPENSE_MAX_BILL_BYTES = 10 * 1024 * 1024;
export const SMALL_EXPENSE_BILL_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

const ALLOWED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type ExpenseBill = {
  id: string;
  expense_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
  is_active: boolean;
};

export function validateSmallExpenseBill(file: Pick<File, "name" | "size" | "type">): string {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (!ALLOWED_TYPES[extension] || ALLOWED_TYPES[extension] !== file.type)
    throw new Error("Bill must be a PDF, JPG, PNG or WebP image.");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > SMALL_EXPENSE_MAX_BILL_BYTES)
    throw new Error("Each bill must be 10 MB or less.");
  if (file.name.trim().length > 200)
    throw new Error("Bill filename must be 200 characters or less.");
  return extension;
}

/** Upload to a private company/uploader folder; link it with the protected RPC. */
export async function uploadSmallExpenseBill(file: File, companyId: string, userId: string, expenseId: string) {
  const ext = validateSmallExpenseBill(file);
  if (!companyId || !userId || !expenseId) throw new Error("Sign in before uploading bills.");
  const path = `${companyId}/${userId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(SMALL_EXPENSE_BILL_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (uploadError) throw uploadError;
  const { error: attachError } = await supabase.rpc("manage_site_small_expense_bill" as never, {
    _expense_id: expenseId,
    _path: path,
    _file_name: file.name,
    _mime_type: file.type,
    _bytes: file.size,
    _remove: false,
  } as never);
  if (attachError) throw attachError;
  return path;
}

export async function removeSmallExpenseBill(expenseId: string, path: string) {
  const { error } = await supabase.rpc("manage_site_small_expense_bill" as never, {
    _expense_id: expenseId,
    _path: path,
    _remove: true,
  } as never);
  if (error) throw error;
}

/** Download directly with the signed-in user's private storage access. */
export async function viewSmallExpenseBill(bill: Pick<ExpenseBill, "storage_path" | "mime_type" | "file_name">) {
  const { data, error } = await supabase.storage.from(SMALL_EXPENSE_BILL_BUCKET).download(bill.storage_path);
  if (error) throw error;
  if (!data) throw new Error("Bill image or PDF could not be loaded.");
  showDocument({
    url: URL.createObjectURL(new Blob([data], { type: bill.mime_type })),
    name: bill.file_name,
    type: bill.mime_type,
  });
}
