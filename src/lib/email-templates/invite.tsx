import { Button, Text } from "@react-email/components";
import { EmailLayout } from "./layout";
import { emailCopy, emailButton } from "./styles";
export function InviteEmail({
  confirmationUrl,
}: {
  siteName: string;
  siteUrl?: string;
  recipient?: string;
  confirmationUrl: string;
}) {
  return (
    <EmailLayout
      title="You’re invited to KK GROUP"
      preview="Your team has invited you to KK GROUP ERP. Set your password to access your workspace."
    >
      <Text className="email-copy" style={emailCopy}>
        Your team has invited you to KK GROUP ERP. Set your password to access your workspace.
      </Text>
      <Button style={emailButton} href={confirmationUrl}>
        Set up my account
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
export default InviteEmail;
