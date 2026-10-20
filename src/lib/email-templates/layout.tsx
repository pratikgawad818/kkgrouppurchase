import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

export function EmailLayout({
  title,
  preview,
  children,
}: {
  title: string;
  preview: string;
  children: ReactNode;
}) {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <style>{`
    @media only screen and (max-width: 600px) { .email-content { padding: 28px 24px !important; } .email-shell { margin: 20px auto !important; } }
    @media (prefers-color-scheme: dark) { .email-bg { background-color: #101722 !important; } .email-content { background-color: #192334 !important; } .email-title { color: #f5f7fb !important; } .email-copy { color: #c7d3e3 !important; } .email-code { background-color: #24334a !important; color: #ffffff !important; } }
  `}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body
        className="email-bg"
        style={{
          margin: 0,
          backgroundColor: "#f1f5fa",
          fontFamily: "Arial, Helvetica, sans-serif",
          padding: "16px 8px",
        }}
      >
        <Container
          className="email-shell"
          style={{
            maxWidth: "560px",
            margin: "32px auto",
            borderRadius: "20px",
            overflow: "hidden",
            border: "1px solid #dce4ee",
          }}
        >
          <Section
            style={{
              backgroundColor: "#14263f",
              padding: "30px 36px 25px",
              borderTop: "4px solid #d4aa63",
            }}
          >
            <Text
              style={{
                color: "#ffffff",
                fontSize: "23px",
                letterSpacing: "3px",
                fontWeight: "bold",
                margin: "0 0 7px",
              }}
            >
              KK GROUP
            </Text>
            <Text style={{ color: "#d4aa63", fontSize: "10px", letterSpacing: "2px", margin: 0 }}>
              PROCUREMENT &amp; PROJECT MANAGEMENT
            </Text>
          </Section>
          <Section
            className="email-content"
            style={{ backgroundColor: "#ffffff", padding: "36px" }}
          >
            <Text
              style={{
                color: "#8b652b",
                fontSize: "11px",
                fontWeight: "bold",
                letterSpacing: "1.8px",
                margin: "0 0 14px",
              }}
            >
              ACCOUNT SECURITY
            </Text>
            <Heading
              className="email-title"
              style={{
                fontSize: "26px",
                lineHeight: "34px",
                color: "#14263f",
                margin: "0 0 18px",
                fontWeight: 700,
              }}
            >
              {title}
            </Heading>
            {children}
            <Hr style={{ borderColor: "#e6ebf1", margin: "28px 0 20px" }} />
            <Text
              className="email-copy"
              style={{ fontSize: "12px", lineHeight: "19px", color: "#738197", margin: 0 }}
            >
              Only use this email for the action you requested in KK GROUP ERP. Our team will never
              ask you to share a verification code or password.
            </Text>
          </Section>
        </Container>
        <Text
          style={{
            textAlign: "center",
            fontSize: "11px",
            lineHeight: "18px",
            color: "#7b8797",
            margin: "0 16px 24px",
          }}
        >
          KK GROUP ERP · Built for your team
          <br />
          This is an automated account security email.
        </Text>
      </Body>
    </Html>
  );
}
export function EmailCode({ token }: { token: string }) {
  return (
    <Section
      className="email-code"
      style={{
        backgroundColor: "#eef4ff",
        border: "1px solid #d4e1fa",
        borderRadius: "14px",
        padding: "22px 8px",
        textAlign: "center",
        margin: "22px 0",
      }}
    >
      <Text
        className="email-copy"
        style={{ color: "#697b96", fontSize: "10px", letterSpacing: "1.8px", margin: "0 0 12px" }}
      >
        YOUR ONE-TIME CODE
      </Text>
      <Text
        className="email-title"
        style={{
          color: "#163b74",
          fontSize: "34px",
          fontFamily: "Courier New, monospace",
          letterSpacing: "8px",
          fontWeight: "bold",
          lineHeight: "42px",
          margin: "0 0 0 8px",
        }}
      >
        {token}
      </Text>
    </Section>
  );
}
