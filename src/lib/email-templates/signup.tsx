import { Button, Text } from "@react-email/components";
import { EmailLayout } from "./layout";
import { emailCopy, emailButton } from "./styles";
export function SignupEmail({
  confirmationUrl,
}: {
  siteName: string;
  siteUrl?: string;
  recipient?: string;
  confirmationUrl: string;
}) {
  return (
    <EmailLayout
      title="Verify your email"
      preview="Welcome to KK GROUP ERP. Verify your email to finish setting up your account."
    >
      <Text className="email-copy" style={emailCopy}>
        Welcome to KK GROUP ERP. Verify your email to finish setting up your account.
      </Text>
      <Button style={emailButton} href={confirmationUrl}>
        Verify email
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
export default SignupEmail;
