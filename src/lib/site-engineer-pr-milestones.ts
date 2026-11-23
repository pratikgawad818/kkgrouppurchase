import type { PurchaseChain, PipelineStep } from "./purchase-pipeline.ts";

export type SitePr = {
  id: string; number: string; purpose: string | null;
  status: string; project: string; due: string | null;
};
export type SitePo = {
  id: string; number: string; prId: string | null;
  status: string;
};
export type SiteDelivery = {
  id: string; number: string; poId: string; status: string;
};
export type SitePrJourneySource = {
  prs: readonly SitePr[];
  pos: readonly SitePo[];
  challans: readonly SiteDelivery[];
  grns: readonly SiteDelivery[];
};

const approvedPo = new Set([
  "approved", "sent", "partially_received", "partially_accepted",
  "fully_received", "short_closed", "closed",
]);
const completePo = new Set(["fully_received", "short_closed", "closed"]);
const submittedPo = new Set(["pending_approval", ...approvedPo]);

type Step = PipelineStep;
const steps: Array<{ key: Step["key"]; label: string }> = [
  { key: "request", label: "PR requested" },
  { key: "pr_received", label: "PR received for procurement" },
  { key: "director_approval", label: "PO sent for Director approval" },
  { key: "challan_entry", label: "Challan entry" },
  { key: "goods_received", label: "Goods received" },
];
const prLink = (id: string) => "/procurement/purchase-requests/" + encodeURIComponent(id);
const poLink = (id: string) => "/procurement/purchase-orders/" + encodeURIComponent(id);
const challanLink = (id: string) => "/inventory/delivery-challans/" + encodeURIComponent(id);
const grnLink = (id: string) => "/inventory/goods-received/" + encodeURIComponent(id);

export type SitePrMilestones = {
  prId: string;
  completed: boolean;
  stages: PipelineStep[];
  stage: string;
  action: string;
  href: string;
};

function documents(rows: readonly { number: string; id: string }[], path: (id: string) => string) {
  return rows.map((row) => ({ number: row.number, href: path(row.id) }));
}

/**
 * One PR can lead to several vendor POs; each PO can have many challans and
 * goods receipts. Never count the first challan/GRN as completion of a whole
 * request. All joining is by source UUIDs returned under RLS, not by project
 * name or date. Cancelled delivery records are excluded.
 */
export function sitePrMilestones(pr: SitePr, all: SitePrJourneySource): SitePrMilestones {
  const allPos = all.pos.filter((po) => po.prId === pr.id);
  const pos = allPos.filter((po) => po.status !== "cancelled");
  const poIds = new Set(pos.map((po) => po.id));
  const challans = all.challans.filter((c) => poIds.has(c.poId) && c.status === "registered");
  const grns = all.grns.filter((g) => poIds.has(g.poId) && g.status !== "cancelled");
  const posted = grns.filter((g) => g.status === "posted");

  const prRequested = pr.status !== "draft" && pr.status !== "cancelled";
  const prReceived = pr.status === "approved";
  const posSent = pos.length > 0 && pos.every((po) => submittedPo.has(po.status));
  const posApproved = pos.length > 0 && pos.every((po) => approvedPo.has(po.status));
  const poWithChallan = new Set(challans.map((ch) => ch.poId));
  const allChallans = pos.length > 0 && pos.every((po) => poWithChallan.has(po.id));
  const goodsComplete = pos.length > 0 && pos.every((po) => completePo.has(po.status))
    && posted.length > 0;

  const completed = prReceived && posApproved && goodsComplete;
  let current = 0;
  if (prRequested) current = 1;
  if (prReceived) current = 2;
  if (posApproved) current = 3;
  if (allChallans) current = 4;

  const done = [prRequested, prReceived, posApproved, allChallans, goodsComplete];
  const refs = [
    [{ number: pr.number, href: prLink(pr.id) }],
    prReceived ? [{ number: pr.number, href: prLink(pr.id) }] : [],
    documents(pos, poLink),
    documents(challans, challanLink),
    documents(grns, grnLink),
  ];
  const stages: PipelineStep[] = steps.map((step, i) => ({
    key: step.key,
    label: step.label,
    documents: refs[i] ?? [],
    state: done[i] ? "done" : current === i ? "current" : "todo",
  }));

  let stage: string, action: string, href: string;
  if (pr.status === "cancelled") {
    stage = "Purchase request cancelled"; action = "View PR"; href = prLink(pr.id);
  } else if (pr.status === "rejected") {
    stage = "Purchase request rejected — review the decision";
    action = "View PR"; href = prLink(pr.id);
  } else if (!prRequested) {
    stage = "PR draft — complete and submit";
    action = "Finish PR"; href = prLink(pr.id);
  } else if (!prReceived) {
    stage = "PR requested — waiting for Purchase Manager, Super Admin or Director";
    action = "View PR"; href = prLink(pr.id);
  } else if (!pos.length) {
    stage = allPos.some((po) => po.status === "cancelled")
      ? "PO cancelled — procurement must arrange another order"
      : "PR received for procurement — preparing a PO for Director approval";
    action = "View PR"; href = prLink(pr.id);
  } else if (!posApproved) {
    const pending = pos.find((po) => po.status === "pending_approval");
    const issue = pos.find((po) => po.status === "rejected");
    stage = issue ? "PO returned for correction — Director review pending"
      : posSent ? "PO sent to Director — awaiting approval"
        : "PO being prepared for Director approval";
    action = "View PO"; href = poLink((pending ?? issue ?? pos[0])!.id);
  } else if (!challans.length) {
    stage = "Director approved PO — awaiting supplier challan";
    action = "View PO"; href = poLink(pos[0]!.id);
  } else if (!allChallans && !grns.length) {
    stage = "Challan recorded — more supplier challans may be pending";
    action = "View challan"; href = challanLink(challans[0]!.id);
  } else if (!grns.length) {
    stage = "Challan entry complete — waiting for goods receipt";
    action = "View challan"; href = challanLink(challans[0]!.id);
  } else if (completed) {
    stage = "Goods received — all linked purchase orders completed";
    action = "View GRN"; href = grnLink((posted.at(-1) ?? grns.at(-1))!.id);
  } else {
    stage = posted.length
      ? "Goods partially received — remaining deliveries or posting pending"
      : "Goods receipt draft — awaiting stock verification";
    action = "View GRN"; href = grnLink(grns.at(-1)!.id);
  }

  return { prId: pr.id, completed, stages, stage, action, href };
}

export function buildSiteEngineerPrTasks(
  source: SitePrJourneySource,
  { includeCompleted = false }: { includeCompleted?: boolean } = {},
): PurchaseChain[] {
  return source.prs.flatMap((pr): PurchaseChain[] => {
    if (pr.status === "cancelled") return [];
    const milestone = sitePrMilestones(pr, source);
    if (milestone.completed && !includeCompleted) return [];
    return [{
      id: "pr:" + pr.id,
      kind: "request",
      group: "purchasing",
      number: pr.number,
      description: pr.purpose || "Purchase request " + pr.number,
      project: pr.project,
      due: pr.due,
      action: milestone.action,
      href: milestone.href,
      stage: milestone.stage,
      steps: milestone.stages,
    }];
  });
}
