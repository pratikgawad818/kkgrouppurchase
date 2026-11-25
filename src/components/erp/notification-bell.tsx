import { useEffect, useState } from "react";
import { createNotificationRefresh, notificationPollInterval } from "@/lib/notification-refresh";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PhoneAlerts } from "@/components/erp/phone-alerts";
import { internalNotificationLink } from "@/lib/push-security";

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function NotificationBell({
  userId,
  isDirector = false,
}: {
  userId: string;
  isDirector?: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ["notifications", userId, isDirector ? "approvals-only" : "all"];
  const [connected, setConnected] = useState(false);
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      // Keep historical notifications in the database, but Directors should
      // see only actionable PO / vendor-payment approval entries in their bell.
      // Server-side filtering happens before LIMIT, so old PR and invoice
      // review spam cannot displace legitimate approvals from the newest 30.
      let request = supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId);
      if (isDirector) request = request.like("link", "/approvals?kind=%");
      const { data, error } = await request
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return isDirector
        ? (data ?? []).filter(n =>
            n.link?.startsWith("/approvals?kind=purchase_order&id=") ||
            n.link?.startsWith("/approvals?kind=vendor_payment&id="))
        : data;
    },
    refetchInterval: notificationPollInterval(connected),
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    let active = true;
    setConnected(false);
    const inboxKey = ["notifications", userId, isDirector ? "approvals-only" : "all"];
    const batch = createNotificationRefresh((approvals) => {
      if (!active) return;
      // Hidden tabs mark queries stale; focus refetches them instead of polling in the background.
      const refetchType = document.visibilityState === "visible" ? "active" : "none";
      void qc.invalidateQueries({ queryKey: inboxKey, refetchType });
      if (isDirector && approvals) {
        void qc.invalidateQueries({ queryKey: ["director-pending-count", userId], refetchType });
        void qc.invalidateQueries({ queryKey: ["director-approvals", userId], refetchType });
      }
    });
    const ch = supabase
      .channel(`notif-${userId}-${isDirector ? "director" : "staff"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // Push delivery is independent. Read/unread updates do not refresh approval counts.
          batch.schedule(payload.eventType === "INSERT");
        },
      )
      .subscribe((status) => {
        if (!active) return;
        setConnected(status === "SUBSCRIBED");
        // Close the fetch/subscribe gap and reconcile missed events after reconnect.
        if (status === "SUBSCRIBED") batch.schedule(true);
      });
    return () => {
      active = false;
      batch.cancel();
      void supabase.removeChannel(ch);
    };
  }, [userId, isDirector, qc]);

  const items = q.data ?? [];
  const unread = items.filter((n) => !n.is_read).length;
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (unread > 0) nav.setAppBadge?.(unread).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [unread]);

  async function open(n: (typeof items)[number]) {
    if (!n.is_read) {
      const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", n.id).eq("user_id", userId);
      if (error) toast.error("Could not mark notification as read. Please try again.");
      else void qc.invalidateQueries({ queryKey: key });
    }
    if (n.link) navigate({ to: internalNotificationLink(n.link) });
  }
  async function readAll() {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (error) toast.error("Could not mark notifications as read. Please try again.");
    else void qc.invalidateQueries({ queryKey: key });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          className="relative h-11 w-11 md:h-9 md:w-9"
        >
          <Bell className="h-5 w-5 md:h-4 md:w-4" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[85dvh] w-[min(360px,calc(100vw-24px))] overflow-y-auto p-0"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button onClick={readAll} className="text-xs font-medium text-primary hover:underline">
              Mark all read
            </button>
          )}
        </div>
        <PhoneAlerts userId={userId} isDirector={isDirector} />
        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => open(n)}
                className={cn(
                  "flex w-full gap-3 border-b px-4 py-3 text-left last:border-0 hover:bg-muted",
                  !n.is_read && "bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    n.is_read ? "bg-transparent" : "bg-primary",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
                  <span className="block text-[11px] text-muted-foreground">
                    {ago(n.created_at)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
