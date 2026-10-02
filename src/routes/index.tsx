import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/auth", replace: true });
  },
  head: () => ({
    meta: [
      { title: "Sign in — KK Group ERP" },
      { name: "description", content: "Sign in to the KK Group ERP workspace." },
      { property: "og:title", content: "Sign in — KK Group ERP" },
      { property: "og:description", content: "Sign in to the KK Group ERP workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => null,
});
