export type EmailProofSide = "old" | "new";
export interface PendingEmailChange {
  id: string;
  oldEmail: string | null;
  newEmail: string;
  oldVerified: boolean;
  newVerified: boolean;
  expiresAt: string;
  resendAt: string;
}

export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name?.slice(0, 2)}•••@${domain}`;
}

export function cleanEmailCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}
