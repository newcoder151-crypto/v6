import { useEffect, useRef } from "react";
import { Bell, CheckCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEvents, useAcknowledgeEvent } from "@/hooks/use-events";
import { API_BASE, tokenStore } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

const SEV_DOT: Record<string, string> = {
  CRITICAL: "bg-red-500", EMERGENCY: "bg-red-500",
  ERROR: "bg-red-400", WARNING: "bg-yellow-400", INFO: "bg-blue-400",
};

const NotificationsDropdown = () => {
  const qc = useQueryClient();
  const { data: events, refetch } = useEvents({ is_acknowledged: 0, limit: 20 });
  const acknowledge = useAcknowledgeEvent();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) return;
    const base = API_BASE || window.location.origin;
    const wsUrl = base.replace(/^http/, "ws") + `/ws?token=${encodeURIComponent(token)}`;
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onmessage = (msg) => {
          try {
            const d = JSON.parse(msg.data);
            if (["event.new","event.acknowledged","events.batch_acknowledged"].includes(d.type)) {
              refetch();
              qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
              qc.invalidateQueries({ queryKey: ["events"] });
            }
          } catch {}
        };
        ws.onclose = () => { retryTimer = setTimeout(connect, 5000); };
        ws.onerror = () => {};
      } catch {}
    };
    connect();
    return () => { clearTimeout(retryTimer); wsRef.current?.close(); };
  }, [refetch, qc]);

  const unread = events?.length ?? 0;

  // acknowledge.mutate expects a number (event_id) directly
  const handleAck = (event_id: number) => {
    acknowledge.mutate(event_id, { onError: () => refetch() });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center animate-pulse">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 bg-card border-border p-0 shadow-xl">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Notifications</span>
          {unread > 0 && (
            <Badge className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">
              {unread} unread
            </Badge>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {unread === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mb-2 text-green-400/50" />
              <p className="text-sm">All caught up</p>
            </div>
          )}
          {events?.map(ev => (
            <div key={ev.event_id}
              className="flex items-start gap-2.5 px-3 py-2.5 border-b border-border/40 hover:bg-muted/30 last:border-0">
              <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEV_DOT[ev.severity] ?? "bg-blue-400"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground leading-tight truncate">{ev.title}</p>
                {ev.camera_name && <p className="text-[10px] text-muted-foreground">{ev.camera_name}</p>}
                <p className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(ev.occurred_at), { addSuffix: true })}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 hover:text-green-400"
                onClick={() => handleAck(ev.event_id)} disabled={acknowledge.isPending} title="Acknowledge">
                <CheckCheck className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        {unread > 0 && (
          <div className="px-3 py-2 border-t border-border">
            <Button size="sm" variant="outline" className="w-full h-7 text-xs"
              onClick={() => events?.forEach(ev => handleAck(ev.event_id))}
              disabled={acknowledge.isPending}>
              <CheckCheck className="h-3 w-3 mr-1" />Acknowledge All
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
export default NotificationsDropdown;
