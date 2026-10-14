import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function NotificationBell({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ["notifications", userId];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications").select("*")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const ch = supabase.channel(`notif-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (p) => {
        qc.invalidateQueries({ queryKey: key });
        const n = p.new as { title: string; body: string | null; link: string | null };
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
          const note = new Notification(n.title, { body: n.body ?? "", icon: "/apple-touch-icon.png" });
          note.onclick = () => { window.focus(); if (n.link) navigate({ to: n.link }); };
        }
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const items = q.data ?? [];
  const unread = items.filter((n) => !n.is_read).length;

  async function open(n: (typeof items)[number]) {
    if (!n.is_read) await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
    qc.invalidateQueries({ queryKey: key });
    if (n.link) navigate({ to: n.link });
  }
  async function readAll() {
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
    qc.invalidateQueries({ queryKey: key });
  }
  const canAsk = typeof Notification !== "undefined" && Notification.permission === "default";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative h-11 w-11 md:h-9 md:w-9">
          <Bell className="h-5 w-5 md:h-4 md:w-4" />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{unread > 9 ? "9+" : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(360px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && <button onClick={readAll} className="text-xs font-medium text-primary hover:underline">Mark all read</button>}
        </div>
        {canAsk && <button onClick={() => Notification.requestPermission()} className="block w-full border-b bg-muted/50 px-4 py-2 text-left text-xs text-muted-foreground hover:bg-muted">Turn on phone/desktop alerts for this device</button>}
        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications yet.</p> :
            items.map((n) => (
              <button key={n.id} onClick={() => open(n)} className={cn("flex w-full gap-3 border-b px-4 py-3 text-left last:border-0 hover:bg-muted", !n.is_read && "bg-primary/5")}>
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.is_read ? "bg-transparent" : "bg-primary")} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
                  <span className="block text-[11px] text-muted-foreground">{ago(n.created_at)}</span>
                </span>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
