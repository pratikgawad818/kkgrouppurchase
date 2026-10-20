import * as React from "react";
import { createAuthEmailHandler } from "@lovable.dev/email-js";
import { createFileRoute } from "@tanstack/react-router";
import { SignupEmail } from "@/lib/email-templates/signup";
import { InviteEmail } from "@/lib/email-templates/invite";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";
import { RecoveryEmail } from "@/lib/email-templates/recovery";
import { EmailChangeEmail } from "@/lib/email-templates/email-change";
import { ReauthenticationEmail } from "@/lib/email-templates/reauthentication";

// Configuration
const SITE_NAME = "KK Group";
const SENDER_DOMAIN = "notify.kkgrouppurchase.in";
const ROOT_DOMAIN = "kkgrouppurchase.in";
// The root domain publishes "v=spf1 -all" and a strict DMARC policy
// (p=reject, adkim=s, aspf=s), so a "noreply@kkgrouppurchase.in" sender fails
// alignment and every message is rejected at dispatch. Sending from the
// verified subdomain keeps the From address aligned with the signing domain.
const FROM_DOMAIN = SENDER_DOMAIN;
const SITE_URL = `https://${ROOT_DOMAIN}`;

// The SDK handler owns verification, dispatch, and retry semantics; this file
// owns only the email decisions: subjects, templates, and per-type props.
export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const handler = createAuthEmailHandler({
          apiKey: process.env["LOVABLE_API_KEY"]!,
          from: { name: SITE_NAME, address: `noreply@${FROM_DOMAIN}` },
          senderDomain: SENDER_DOMAIN,
          sendUrl: process.env["LOVABLE_SEND_URL"],
          emails: {
            signup: {
              subject: "Confirm your email",
              render: (data) =>
                React.createElement(SignupEmail, {
                  siteName: SITE_NAME,
                  siteUrl: SITE_URL,
                  recipient: data.email,
                  confirmationUrl: data.url,
                }),
            },
            invite: {
              subject: "You've been invited",
              render: (data) =>
                React.createElement(InviteEmail, {
                  siteName: SITE_NAME,
                  siteUrl: SITE_URL,
                  confirmationUrl: data.url,
                }),
            },
            magiclink: {
              subject: "Your login link",
              render: (data) =>
                React.createElement(MagicLinkEmail, {
                  siteName: SITE_NAME,
                  confirmationUrl: data.url,
                }),
            },
            recovery: {
              subject: "Reset your password",
              render: (data) =>
                React.createElement(RecoveryEmail, {
                  siteName: SITE_NAME,
                  confirmationUrl: data.url,
                }),
            },
            email_change: {
              subject: "Your email verification code · KK GROUP ERP",
              render: (data) =>
                React.createElement(EmailChangeEmail, {
                  siteName: SITE_NAME,
                  oldEmail: data.old_email ?? "",
                  email: data.email,
                  newEmail: data.new_email ?? "",
                  token:
                    (data.email === data.new_email ? data.new_token : data.token) ??
                    data.token ??
                    "",
                }),
            },
            reauthentication: {
              subject: "Your verification code",
              render: (data) =>
                React.createElement(ReauthenticationEmail, { token: data.token ?? "" }),
            },
          },
        });
        return handler(request);
      },
    },
  },
});
