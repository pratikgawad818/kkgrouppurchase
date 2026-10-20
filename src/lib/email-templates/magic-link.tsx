import { Button, Text } from "@react-email/components";
import { EmailLayout } from "./layout";
import { emailCopy, emailButton } from "./styles";
export function MagicLinkEmail({
  confirmationUrl,
}: {
  siteName: string;
  siteUrl?: string;
  recipient?: string;
  confirmationUrl: string;
}) {
  return (
    <EmailLayout
      title="Your secure sign-in link"
      preview="Use the button below to sign in to KK GROUP ERP. Only continue if you requested this email."
    >
      <Text className="email-copy" style={emailCopy}>
        Use the button below to sign in to KK GROUP ERP. Only continue if you requested this email.
      </Text>
      <Button style={emailButton} href={confirmationUrl}>
        Sign in securely
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
export default MagicLinkEmail;
