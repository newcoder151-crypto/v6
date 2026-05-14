// import { useQuery } from "@tanstack/react-query";
// import { Bot, CheckCircle2, XCircle, Activity, Server } from "lucide-react";
// import { AppLayout } from "@/components/layout/AppLayout";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Badge } from "@/components/ui/badge";
// import { Progress } from "@/components/ui/progress";
// import { apiGet } from "@/lib/api";
// import { useCameras } from "@/hooks/use-cameras";
// import { useEvents } from "@/hooks/use-events";

// const AiHealth = () => {
//   const { data: sidecar } = useQuery({ queryKey:["ai-health"], queryFn:()=>apiGet<any>("/api/ai/health"), refetchInterval:10000 });
//   const { data: analytics } = useQuery({ queryKey:["ai-analytics"], queryFn:()=>apiGet<any>("/api/ai/analytics"), refetchInterval:30000 });
//   const { data: nvrHealth } = useQuery({ queryKey:["nvr-health"], queryFn:()=>apiGet<any>("/api/nvr/health"), refetchInterval:15000 });
//   const { data: cameras } = useCameras();
//   const { data: events } = useEvents({ limit: 200 });
//   const aiEvents = events?.filter(e=>["CROWD_DENSITY","INTRUSION","ALARM","TAMPERING"].includes(e.event_type))||[];
//   const totalEvents = analytics?.by_type?.reduce((s:number,r:any)=>s+parseInt(r.count),0)||0;

//   return (
//     <AppLayout>
//       <div className="space-y-6">
//         <div>
//           <h1 className="text-2xl font-bold text-foreground">AI Health</h1>
//           <p className="text-sm text-muted-foreground">YOLO sidecar and NVR core status</p>
//         </div>

//         <div className="grid md:grid-cols-2 gap-4">
//           {/* YOLO Sidecar */}
//           <Card className="bg-card border-border">
//             <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4 text-ai-glow"/>YOLO Sidecar</CardTitle></CardHeader>
//             <CardContent>
//               {sidecar?.sidecar==="up" ? (
//                 <div className="space-y-3">
//                   <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-400"/><span className="text-green-400 font-medium">Online</span></div>
//                   <div className="grid grid-cols-2 gap-2 text-xs">
//                     <div><p className="text-muted-foreground">URL</p><p className="font-mono truncate">{sidecar.url}</p></div>
//                     <div><p className="text-muted-foreground">Default Model</p><p>{sidecar.default_model||"yolov8n"}</p></div>
//                     <div className="col-span-2"><p className="text-muted-foreground mb-1">Loaded Models</p>
//                       <div className="flex gap-1 flex-wrap">{sidecar.loaded_models?.map((m: string)=><Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>)}</div>
//                     </div>
//                   </div>
//                 </div>
//               ) : (
//                 <div className="space-y-2">
//                   <div className="flex items-center gap-2"><XCircle className="h-5 w-5 text-destructive"/><span className="text-destructive font-medium">Offline</span></div>
//                   <p className="text-xs text-muted-foreground">{sidecar?.error||"Could not connect"}</p>
//                   <div className="p-3 bg-muted/30 rounded text-xs font-mono space-y-0.5">
//                     <p className="text-muted-foreground"># Start the sidecar:</p>
//                     <p>cd server/ai</p>
//                     <p>pip install -r requirements.txt</p>
//                     <p>uvicorn sidecar:app --host 0.0.0.0 --port 8000</p>
//                   </div>
//                 </div>
//               )}
//             </CardContent>
//           </Card>

//           {/* NVR Core */}
//           <Card className="bg-card border-border">
//             <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4 text-primary"/>NVR Core Daemon (mNVR)</CardTitle></CardHeader>
//             <CardContent>
//               {nvrHealth?.status==="up" ? (
//                 <div className="space-y-3">
//                   <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-400"/><span className="text-green-400 font-medium">Online</span></div>
//                   <div className="grid grid-cols-2 gap-2 text-xs">
//                     <div><p className="text-muted-foreground">Device</p><p>{nvrHealth.data?.device_name||"—"}</p></div>
//                     <div><p className="text-muted-foreground">Cameras</p><p>{nvrHealth.data?.num_cameras||0}</p></div>
//                     <div><p className="text-muted-foreground">CPU</p><p>{Number(nvrHealth.data?.cpu_pct||0).toFixed(1)}%</p></div>
//                     <div><p className="text-muted-foreground">Disk Free</p><p>{Number(nvrHealth.data?.disk_free_gb||0).toFixed(1)} GB</p></div>
//                   </div>
//                 </div>
//               ) : (
//                 <div className="space-y-2">
//                   <div className="flex items-center gap-2"><XCircle className="h-5 w-5 text-destructive"/><span className="text-destructive font-medium">Offline</span></div>
//                   <p className="text-xs text-muted-foreground">{nvrHealth?.error||"NVR daemon not running"}</p>
//                   <div className="p-3 bg-muted/30 rounded text-xs font-mono space-y-0.5">
//                     <p className="text-muted-foreground"># Build and start NVR core:</p>
//                     <p>cd nvr_core</p>
//                     <p>make && sudo ./mnvrd -c config/mnvr.conf</p>
//                   </div>
//                 </div>
//               )}
//             </CardContent>
//           </Card>
//         </div>

//         {/* Severity breakdown */}
//         {analytics?.by_severity?.length > 0 && (
//           <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
//             {analytics.by_severity.map((row: any) => (
//               <Card key={row.severity} className="bg-card border-border"><CardContent className="p-4">
//                 <p className="text-2xl font-bold text-foreground">{row.count}</p>
//                 <p className="text-xs text-muted-foreground">{row.severity}</p>
//                 <Progress value={totalEvents>0?(row.count/totalEvents)*100:0} className="h-1 mt-2"/>
//               </CardContent></Card>
//             ))}
//           </div>
//         )}

//         {/* Per-camera AI coverage */}
//         <Card className="bg-card border-border">
//           <CardHeader className="pb-2"><CardTitle className="text-sm">Camera AI Coverage</CardTitle></CardHeader>
//           <CardContent className="divide-y divide-border">
//             {cameras?.map(cam => {
//               const camEvents = aiEvents.filter(e=>e.camera_id===cam.camera_id);
//               return (
//                 <div key={cam.camera_id} className="flex items-center justify-between py-2.5">
//                   <div className="flex items-center gap-2">
//                     <div className={`w-2 h-2 rounded-full ${cam.is_online?"bg-green-500":"bg-gray-400"}`}/>
//                     <span className="text-sm text-foreground">{cam.camera_name}</span>
//                     <span className="text-xs text-muted-foreground hidden sm:block">{cam.location_description}</span>
//                   </div>
//                   <div className="flex gap-2 items-center">
//                     <Badge variant="outline" className="text-[10px]">{camEvents.length} AI events</Badge>
//                     <Badge variant="outline" className={`text-[10px] ${cam.status==="ACTIVE"?"text-green-400":""}`}>{cam.status}</Badge>
//                   </div>
//                 </div>
//               );
//             })}
//             {!cameras?.length && <p className="text-sm text-muted-foreground text-center py-4">No cameras configured</p>}
//           </CardContent>
//         </Card>

//         {/* Top event types */}
//         <Card className="bg-card border-border">
//           <CardHeader className="pb-2"><CardTitle className="text-sm">Top AI Event Types (24h)</CardTitle></CardHeader>
//           <CardContent className="space-y-2">
//             {analytics?.by_type?.slice(0,10).map((row: any)=>(
//               <div key={row.event_type} className="flex items-center justify-between">
//                 <span className="text-sm text-foreground">{row.event_type}</span>
//                 <div className="flex items-center gap-2">
//                   <div className="h-1.5 bg-primary/30 rounded-full" style={{width:`${Math.min(100,row.count*5)}px`}}/>
//                   <Badge variant="secondary" className="text-xs">{row.count}</Badge>
//                 </div>
//               </div>
//             ))}
//             {!analytics?.by_type?.length && <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>}
//           </CardContent>
//         </Card>
//       </div>
//     </AppLayout>
//   );
// };
// export default AiHealth;

import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  Video,
  VideoOff,
  AlertTriangle,
  Activity,
  Clock,
  Network,
  Cpu,
  BrainCircuit,
  BarChart3,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { apiGet } from "@/lib/api";
import { useCameras } from "@/hooks/use-cameras";
import { useEvents } from "@/hooks/use-events";
import { formatDistanceToNow } from "date-fns";

const STATUS_COLOR: Record<string, string> = {
  ACTIVE:
    "text-green-700 dark:text-green-400  bg-green-500/10 border-green-500/20",
  INACTIVE:
    "text-gray-600  dark:text-gray-400   bg-gray-500/10  border-gray-500/20",
  FAULTY:
    "text-red-700   dark:text-red-400    bg-red-500/10   border-red-500/20",
  MAINTENANCE:
    "text-yellow-700 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
};

const AiHealth = () => {
  const {
    data: cameras,
    isLoading: camsLoading,
    refetch: refetchCams,
  } = useCameras();
  const { data: events } = useEvents({ limit: 500 });

  const { data: aiHealth, refetch: refetchAi } = useQuery({
    queryKey: ["ai-health"],
    queryFn: () => apiGet<any>("/api/ai/health"),
    refetchInterval: 10000,
  });

  const { data: analytics } = useQuery({
    queryKey: ["ai-analytics"],
    queryFn: () => apiGet<any>("/api/ai/analytics"),
    refetchInterval: 30000,
  });

  // Per-camera health history
  const { data: allHealthMap } = useQuery({
    queryKey: ["all-camera-health"],
    queryFn: async () => {
      if (!cameras) return {};
      const results: Record<number, any[]> = {};
      await Promise.all(
        cameras.map(async (cam) => {
          try {
            const d = await apiGet<{ health: any[] }>(
              `/api/cameras/${cam.camera_id}/health`,
            );
            results[cam.camera_id] = d.health ?? [];
          } catch {
            results[cam.camera_id] = [];
          }
        }),
      );
      return results;
    },
    enabled: !!cameras?.length,
    refetchInterval: 20000,
  });

  const activeCams = cameras?.filter((c) => c.status === "ACTIVE").length ?? 0;
  const onlineCams = cameras?.filter((c) => c.is_online === 1).length ?? 0;
  const recordingCams =
    cameras?.filter((c) => c.is_recording === 1).length ?? 0;
  const faultyCams = cameras?.filter((c) => c.status === "FAULTY").length ?? 0;

  // Events per camera (last 24h)
  const eventsPerCam = (camId: number) =>
    events?.filter((e) => e.camera_id === camId).length ?? 0;

  // Last health record for a camera
  const latestHealth = (camId: number) =>
    (allHealthMap?.[camId] ?? [])[0] ?? null;

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <BrainCircuit className="h-6 w-6 text-primary" />
              AI & Camera Health
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Live health status for all cameras and AI subsystem
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              refetchCams();
              refetchAi();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </Button>
        </div>

        {/* ── Top summary cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              label: "Active Cameras",
              val: activeCams,
              icon: Video,
              color: "text-green-700 dark:text-green-400",
            },
            {
              label: "Online / Streaming",
              val: onlineCams,
              icon: Wifi,
              color: "text-blue-700 dark:text-blue-400",
            },
            {
              label: "Currently Recording",
              val: recordingCams,
              icon: Activity,
              color: "text-red-600 dark:text-red-400",
            },
            {
              label: "Faulty Cameras",
              val: faultyCams,
              icon: AlertTriangle,
              color:
                faultyCams > 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground",
            },
          ].map(({ label, val, icon: Icon, color }) => (
            <Card key={label} className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{val}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── YOLO AI sidecar status ────────────────────────────────────────── */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 border-b border-border/60">
            <CardTitle className="text-sm flex items-center gap-2 text-foreground">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              YOLO AI Sidecar
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {aiHealth?.sidecar === "up" ? (
              <div className="flex items-start gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                    Online
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                  <span>
                    URL:{" "}
                    <code className="font-mono">
                      {aiHealth.url ?? "localhost:8000"}
                    </code>
                  </span>
                  <span>
                    Default model:{" "}
                    <code className="font-mono">
                      {aiHealth.default_model ?? "yolov8n.pt"}
                    </code>
                  </span>
                </div>
                {aiHealth.loaded_models?.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {aiHealth.loaded_models.map((m: string) => (
                      <Badge
                        key={m}
                        variant="secondary"
                        className="text-[10px]"
                      >
                        {m}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-destructive" />
                  <span className="text-sm font-semibold text-destructive">
                    Offline
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {aiHealth?.error ?? "Not reachable"}
                </p>
                <div className="mt-2 p-3 bg-muted/40 rounded text-xs font-mono text-muted-foreground">
                  <p># Start the AI sidecar:</p>
                  <p className="text-green-700 dark:text-green-400">
                    bash start.sh
                  </p>
                  <p className="mt-1"># Or without full system:</p>
                  <p className="text-green-700 dark:text-green-400">
                    cd server/ai && uvicorn sidecar:app --port 8000
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Per-camera health ─────────────────────────────────────────────── */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 border-b border-border/60">
            <CardTitle className="text-sm flex items-center gap-2 text-foreground">
              <Video className="h-4 w-4 text-muted-foreground" />
              Camera Health
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {cameras?.length ?? 0} cameras total
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {camsLoading && (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 bg-muted/30 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            )}

            {!camsLoading && !cameras?.length && (
              <div className="text-center py-10 text-muted-foreground">
                <Video className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm text-foreground">No cameras configured</p>
                <p className="text-xs mt-1">
                  Add cameras via the Camera Grid page
                </p>
              </div>
            )}

            <div className="divide-y divide-border">
              {cameras?.map((cam) => {
                const health = latestHealth(cam.camera_id);
                const camEvents = eventsPerCam(cam.camera_id);
                const fps = health?.frame_rate_actual ?? cam.frame_rate_actual;
                const kbps = health?.bitrate_kbps ?? cam.bitrate_kbps;
                const errCount = health?.error_count ?? 0;
                const lastErr = health?.last_error ?? cam.last_error;
                const isOnline = (health?.is_online ?? cam.is_online) === 1;
                const isRecording =
                  (health?.is_recording ?? cam.is_recording) === 1;

                return (
                  <div key={cam.camera_id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: name + status */}
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div
                          className={`mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 ${
                            cam.status === "ACTIVE" && isOnline
                              ? "bg-green-500"
                              : cam.status === "ACTIVE"
                                ? "bg-yellow-500 animate-pulse"
                                : cam.status === "FAULTY"
                                  ? "bg-red-500"
                                  : "bg-gray-400"
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-foreground">
                              {cam.camera_name}
                            </p>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${STATUS_COLOR[cam.status] ?? ""}`}
                            >
                              {cam.status}
                            </Badge>
                            {isRecording && (
                              <Badge className="text-[10px] bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 animate-pulse">
                                ● REC
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Network className="h-2.5 w-2.5" />
                              <span className="font-mono">
                                {cam.ip_address || "—"}
                              </span>
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {cam.location_description || cam.camera_type}
                            </span>
                            {isOnline ? (
                              <span className="flex items-center gap-0.5 text-[10px] text-green-700 dark:text-green-400">
                                <Wifi className="h-2.5 w-2.5" />
                                Online
                              </span>
                            ) : (
                              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <WifiOff className="h-2.5 w-2.5" />
                                Offline
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: metrics */}
                      <div className="flex items-center gap-4 shrink-0 flex-wrap justify-end">
                        {fps != null && (
                          <div className="text-right">
                            <p className="text-xs font-semibold text-foreground">
                              {fps} fps
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Frame rate
                            </p>
                          </div>
                        )}
                        {kbps != null && (
                          <div className="text-right">
                            <p className="text-xs font-semibold text-foreground">
                              {kbps} kbps
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Bitrate
                            </p>
                          </div>
                        )}
                        <div className="text-right">
                          <p
                            className={`text-xs font-semibold ${camEvents > 0 ? "text-orange-600 dark:text-orange-400" : "text-foreground"}`}
                          >
                            {camEvents}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Events
                          </p>
                        </div>
                        {errCount > 0 && (
                          <div className="text-right">
                            <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                              {errCount}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Errors
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Error message */}
                    {lastErr && (
                      <div className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/5 border border-red-500/20">
                        <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                        <p className="text-[10px] text-red-600 dark:text-red-400 truncate">
                          {lastErr}
                        </p>
                      </div>
                    )}

                    {/* Health history sparkline (last 10 records) */}
                    {(allHealthMap?.[cam.camera_id]?.length ?? 0) > 1 && (
                      <div className="mt-2 flex items-center gap-0.5">
                        {(allHealthMap![cam.camera_id] ?? [])
                          .slice(0, 10)
                          .reverse()
                          .map((h, i) => (
                            <div
                              key={i}
                              className={`h-3 flex-1 rounded-sm ${h.is_online === 1 ? "bg-green-500/60" : "bg-red-500/40"}`}
                              title={h.is_online === 1 ? "Online" : "Offline"}
                            />
                          ))}
                        <span className="text-[9px] text-muted-foreground ml-1">
                          last 10
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ── Analytics summary ─────────────────────────────────────────────── */}
        {analytics && (
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-foreground">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  Events by Severity (24h)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {analytics.by_severity?.length > 0 ? (
                  analytics.by_severity.map((row: any) => {
                    const col =
                      row.severity === "CRITICAL" ||
                      row.severity === "EMERGENCY"
                        ? "bg-red-500"
                        : row.severity === "WARNING"
                          ? "bg-yellow-500"
                          : row.severity === "ERROR"
                            ? "bg-orange-500"
                            : "bg-blue-500";
                    const max = Math.max(
                      1,
                      ...analytics.by_severity.map((r: any) =>
                        parseInt(r.count),
                      ),
                    );
                    return (
                      <div
                        key={row.severity}
                        className="flex items-center gap-2"
                      >
                        <span className="text-xs text-muted-foreground w-20 shrink-0">
                          {row.severity}
                        </span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${col} rounded-full`}
                            style={{
                              width: `${(parseInt(row.count) / max) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-foreground w-6 text-right">
                          {row.count}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No data yet
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-foreground">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Top Cameras by Events (24h)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {analytics.by_camera?.length > 0 ? (
                  analytics.by_camera.slice(0, 6).map((row: any) => {
                    const max = Math.max(
                      1,
                      ...analytics.by_camera.map((r: any) => parseInt(r.count)),
                    );
                    return (
                      <div
                        key={row.camera_id}
                        className="flex items-center gap-2"
                      >
                        <span className="text-xs text-foreground truncate flex-1">
                          {row.camera_name || `Cam ${row.camera_id}`}
                        </span>
                        <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{
                              width: `${(parseInt(row.count) / max) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-foreground w-6 text-right">
                          {row.count}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No data yet
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default AiHealth;
