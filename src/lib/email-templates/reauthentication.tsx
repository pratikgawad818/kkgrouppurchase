import { Text } from "@react-email/components";
import { EmailCode, EmailLayout } from "./layout";
import { emailCopy } from "./styles";
export function ReauthenticationEmail({ token }: { token: string }) {
  return (
    <EmailLayout title="Confirm it’s you" preview="Your one-time security code for KK GROUP ERP.">
      <Text className="email-copy" style={emailCopy}>
        Enter this code in KK GROUP ERP to confirm your identity and continue.
      </Text>
      <EmailCode token={token} />
      <Text className="email-copy" style={{ ...emailCopy, fontSize: "12px" }}>
        This code expires shortly. If you didn’t request it, ignore this email and never share the
        code.
      </Text>
    </EmailLayout>
  );
}
export default ReauthenticationEmail;
