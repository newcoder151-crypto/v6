import { useQuery } from "@tanstack/react-query";
import { Bot, CheckCircle2, XCircle, Activity, Server } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { apiGet } from "@/lib/api";
import { useCameras } from "@/hooks/use-cameras";
import { useEvents } from "@/hooks/use-events";

const AiHealth = () => {
  const { data: sidecar } = useQuery({ queryKey:["ai-health"], queryFn:()=>apiGet<any>("/api/ai/health"), refetchInterval:10000 });
  const { data: analytics } = useQuery({ queryKey:["ai-analytics"], queryFn:()=>apiGet<any>("/api/ai/analytics"), refetchInterval:30000 });
  const { data: nvrHealth } = useQuery({ queryKey:["nvr-health"], queryFn:()=>apiGet<any>("/api/nvr/health"), refetchInterval:15000 });
  const { data: cameras } = useCameras();
  const { data: events } = useEvents({ limit: 200 });
  const aiEvents = events?.filter(e=>["CROWD_DENSITY","INTRUSION","ALARM","TAMPERING"].includes(e.event_type))||[];
  const totalEvents = analytics?.by_type?.reduce((s:number,r:any)=>s+parseInt(r.count),0)||0;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Health</h1>
          <p className="text-sm text-muted-foreground">YOLO sidecar and NVR core status</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* YOLO Sidecar */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4 text-ai-glow"/>YOLO Sidecar</CardTitle></CardHeader>
            <CardContent>
              {sidecar?.sidecar==="up" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-400"/><span className="text-green-400 font-medium">Online</span></div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><p className="text-muted-foreground">URL</p><p className="font-mono truncate">{sidecar.url}</p></div>
                    <div><p className="text-muted-foreground">Default Model</p><p>{sidecar.default_model||"yolov8n"}</p></div>
                    <div className="col-span-2"><p className="text-muted-foreground mb-1">Loaded Models</p>
                      <div className="flex gap-1 flex-wrap">{sidecar.loaded_models?.map((m: string)=><Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>)}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><XCircle className="h-5 w-5 text-destructive"/><span className="text-destructive font-medium">Offline</span></div>
                  <p className="text-xs text-muted-foreground">{sidecar?.error||"Could not connect"}</p>
                  <div className="p-3 bg-muted/30 rounded text-xs font-mono space-y-0.5">
                    <p className="text-muted-foreground"># Start the sidecar:</p>
                    <p>cd server/ai</p>
                    <p>pip install -r requirements.txt</p>
                    <p>uvicorn sidecar:app --host 0.0.0.0 --port 8000</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* NVR Core */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4 text-primary"/>NVR Core Daemon (mNVR)</CardTitle></CardHeader>
            <CardContent>
              {nvrHealth?.status==="up" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-400"/><span className="text-green-400 font-medium">Online</span></div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><p className="text-muted-foreground">Device</p><p>{nvrHealth.data?.device_name||"—"}</p></div>
                    <div><p className="text-muted-foreground">Cameras</p><p>{nvrHealth.data?.num_cameras||0}</p></div>
                    <div><p className="text-muted-foreground">CPU</p><p>{Number(nvrHealth.data?.cpu_pct||0).toFixed(1)}%</p></div>
                    <div><p className="text-muted-foreground">Disk Free</p><p>{Number(nvrHealth.data?.disk_free_gb||0).toFixed(1)} GB</p></div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><XCircle className="h-5 w-5 text-destructive"/><span className="text-destructive font-medium">Offline</span></div>
                  <p className="text-xs text-muted-foreground">{nvrHealth?.error||"NVR daemon not running"}</p>
                  <div className="p-3 bg-muted/30 rounded text-xs font-mono space-y-0.5">
                    <p className="text-muted-foreground"># Build and start NVR core:</p>
                    <p>cd nvr_core</p>
                    <p>make && sudo ./mnvrd -c config/mnvr.conf</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Severity breakdown */}
        {analytics?.by_severity?.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {analytics.by_severity.map((row: any) => (
              <Card key={row.severity} className="bg-card border-border"><CardContent className="p-4">
                <p className="text-2xl font-bold text-foreground">{row.count}</p>
                <p className="text-xs text-muted-foreground">{row.severity}</p>
                <Progress value={totalEvents>0?(row.count/totalEvents)*100:0} className="h-1 mt-2"/>
              </CardContent></Card>
            ))}
          </div>
        )}

        {/* Per-camera AI coverage */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Camera AI Coverage</CardTitle></CardHeader>
          <CardContent className="divide-y divide-border">
            {cameras?.map(cam => {
              const camEvents = aiEvents.filter(e=>e.camera_id===cam.camera_id);
              return (
                <div key={cam.camera_id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${cam.is_online?"bg-green-500":"bg-gray-400"}`}/>
                    <span className="text-sm text-foreground">{cam.camera_name}</span>
                    <span className="text-xs text-muted-foreground hidden sm:block">{cam.location_description}</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Badge variant="outline" className="text-[10px]">{camEvents.length} AI events</Badge>
                    <Badge variant="outline" className={`text-[10px] ${cam.status==="ACTIVE"?"text-green-400":""}`}>{cam.status}</Badge>
                  </div>
                </div>
              );
            })}
            {!cameras?.length && <p className="text-sm text-muted-foreground text-center py-4">No cameras configured</p>}
          </CardContent>
        </Card>

        {/* Top event types */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Top AI Event Types (24h)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {analytics?.by_type?.slice(0,10).map((row: any)=>(
              <div key={row.event_type} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{row.event_type}</span>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 bg-primary/30 rounded-full" style={{width:`${Math.min(100,row.count*5)}px`}}/>
                  <Badge variant="secondary" className="text-xs">{row.count}</Badge>
                </div>
              </div>
            ))}
            {!analytics?.by_type?.length && <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};
export default AiHealth;
