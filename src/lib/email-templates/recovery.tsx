import { Button, Text } from "@react-email/components";
import { EmailLayout } from "./layout";
import { emailCopy, emailButton } from "./styles";
export function RecoveryEmail({
  confirmationUrl,
}: {
  siteName: string;
  siteUrl?: string;
  recipient?: string;
  confirmationUrl: string;
}) {
  return (
    <EmailLayout
      title="Reset your password"
      preview="We received a request to reset your KK GROUP ERP password. Choose a new password using the secure button below."
    >
      <Text className="email-copy" style={emailCopy}>
        We received a request to reset your KK GROUP ERP password. Choose a new password using the
        secure button below.
      </Text>
      <Button style={emailButton} href={confirmationUrl}>
        Reset password
      </Button>
      <Text
        className="email-copy"
        style={{ ...emailCopy, fontSize: "12px", marginTop: "18px", marginBottom: 0 }}
      >
        If you didn’t request this, you can safely ignore this email. Your account stays unchanged.
      </Text>
    </EmailLayout>
  );
}
export default RecoveryEmail;
