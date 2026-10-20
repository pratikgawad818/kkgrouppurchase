import { Text } from "@react-email/components";
import { EmailCode, EmailLayout } from "./layout";
import { emailCopy } from "./styles";
interface EmailChangeEmailProps {
  siteName: string;
  oldEmail: string;
  email: string;
  newEmail: string;
  token: string;
  firstEmail?: boolean;
}
export function EmailChangeEmail({
  email,
  oldEmail,
  newEmail,
  token,
  firstEmail = false,
}: EmailChangeEmailProps) {
  const isOld = !firstEmail && email.toLowerCase() === oldEmail.toLowerCase();
  return (
    <EmailLayout
      title={
        firstEmail
          ? "Verify your email"
          : isOld
            ? "Approve your email change"
            : "Verify your new email"
      }
      preview="Enter your one-time code in My Profile to verify this inbox."
    >
      <Text className="email-copy" style={emailCopy}>
        {firstEmail
          ? "You’re adding an email to your KK GROUP ERP account. Enter this code in My Profile to verify this inbox."
          : isOld
            ? "You requested to change your sign-in email. Enter this code in the Current email box in My Profile to approve the change."
            : "One more step to connect your new inbox. Enter this code in the New email box in My Profile."}
      </Text>
      <EmailCode token={token} />
      <Text className="email-copy" style={{ ...emailCopy, fontSize: "13px" }}>
        This code expires in <strong>10 minutes</strong>. Keep the ERP open while you check your
        inbox.
      </Text>
      {!firstEmail && (
        <Text
          className="email-copy"
          style={{
            ...emailCopy,
            fontSize: "13px",
            padding: "16px",
            backgroundColor: "transparent",
              border: "1px solid #dce4ee",
            borderRadius: "10px",
            overflowWrap: "anywhere",
          }}
        >
          Requested email: <strong>{newEmail}</strong>
          <br />
          Your email changes only after both inboxes are verified.
        </Text>
      )}
      <Text className="email-copy" style={{ ...emailCopy, fontSize: "12px", marginBottom: 0 }}>
        Didn’t request this? Do not share this code. Keep your current sign-in details and contact
        your administrator.
      </Text>
    </EmailLayout>
  );
}
export default EmailChangeEmail;
