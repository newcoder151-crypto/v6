import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Play, Pause, Download, SkipBack, SkipForward,
  Volume2, VolumeX, Bot, Camera, Network, Users,
  ShieldAlert, Eye, Cpu, Activity, CheckCircle2
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRecordings } from "@/hooks/use-recordings";
import { useCameras } from "@/hooks/use-cameras";
import { getStreamUrl, getDownloadUrl, getHlsUrl, detectObjects, type Detection, API_BASE, tokenStore } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const AI_MODES = [
  { key: "detect",    label: "Object Detection",   endpoint: "/api/ai/detect",       color: "#ff8800" },
  { key: "people",    label: "People Count",        endpoint: "/api/ai/people-count", color: "#00ff88" },
  { key: "intrusion", label: "Intrusion Detection", endpoint: "/api/ai/intrusion",    color: "#ff4444" },
];

const BOX_COLORS: Record<string, string> = {
  person: "#00ff88", fire: "#ff0000", smoke: "#ff6600",
  "cell phone": "#ffff00", car: "#ff8800", truck: "#ff8800",
  cow: "#aa44ff", dog: "#aa44ff", cat: "#aa44ff",
};
const boxColor = (lbl: string) => BOX_COLORS[lbl] ?? "#ff8800";

// ── AI results panel ─────────────────────────────────────────────────────────
function AiPanel({ detections, inferenceMs, peopleCount, densityPct, densityLevel,
                   intrusionDetected, intruderCount, frameCount, aiMode }: {
  detections: Detection[]; inferenceMs: number | null; peopleCount: number | null;
  densityPct: number | null; densityLevel: string | null;
  intrusionDetected: boolean | null; intruderCount: number | null;
  frameCount: number; aiMode: string;
}) {
  const summary: Record<string, number> = {};
  detections.forEach(d => { summary[d.label] = (summary[d.label] || 0) + 1; });
  const densityColor = densityLevel === "HIGH" ? "text-red-400"
    : densityLevel === "MEDIUM" ? "text-yellow-400" : "text-green-400";

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 border-b border-border/60">
        <CardTitle className="text-sm flex items-center gap-2">
          <Cpu className="h-4 w-4 text-ai-glow" />
          AI Analysis
          {inferenceMs != null && <Badge variant="secondary" className="text-[10px] ml-auto">{inferenceMs}ms</Badge>}
          {frameCount > 0 && <span className="text-[10px] text-muted-foreground ml-1">#{frameCount}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-3">
        {frameCount === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-xs">Enable AI then play a video</p>
            <p className="text-[10px] mt-1 opacity-70">Overlay + results appear here</p>
          </div>
        ) : (
          <>
            {/* People count */}
            {aiMode === "people" && (
              <div className="p-2.5 rounded-lg bg-green-500/5 border border-green-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-green-400" />People
                  </span>
                  <span className="text-xl font-bold text-green-400">{peopleCount ?? 0}</span>
                </div>
                {densityPct != null && (
                  <>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">Crowd Density</span>
                      <span className={densityColor}>{densityPct}% — {densityLevel}</span>
                    </div>
                    <Progress value={densityPct} className="h-1.5" />
                  </>
                )}
              </div>
            )}

            {/* Intrusion */}
            {aiMode === "intrusion" && intrusionDetected != null && (
              <div className={`p-2.5 rounded-lg border ${intrusionDetected
                ? "bg-red-500/10 border-red-500/30" : "bg-green-500/5 border-green-500/20"}`}>
                <div className="flex items-center gap-2">
                  <ShieldAlert className={`h-4 w-4 ${intrusionDetected ? "text-red-400 animate-pulse" : "text-green-400"}`} />
                  <span className={`text-sm font-semibold ${intrusionDetected ? "text-red-400" : "text-green-400"}`}>
                    {intrusionDetected ? `INTRUSION — ${intruderCount} object(s)` : "Zone Clear"}
                  </span>
                </div>
              </div>
            )}

            {/* Object summary */}
            {Object.keys(summary).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Detected</p>
                {Object.entries(summary).sort(([,a],[,b]) => b-a).map(([label, count]) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: boxColor(label) }} />
                    <span className="text-xs text-foreground capitalize flex-1">{label}</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1">{count}</Badge>
                  </div>
                ))}
              </div>
            )}

            {detections.length === 0 && (
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs">No objects detected</span>
              </div>
            )}

            {/* All detections scroll */}
            {detections.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  All ({detections.length})
                </p>
                {detections.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 py-0.5">
                    <span className="text-[10px] text-muted-foreground w-4">{i+1}</span>
                    <span className="text-[10px] text-foreground capitalize flex-1">{d.label}</span>
                    <span className="text-[10px] font-mono" style={{ color: boxColor(d.label) }}>
                      {(d.confidence*100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
const VideoPlayer = () => {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hlsRef    = useRef<any>(null);
  const aiTimer   = useRef<ReturnType<typeof setInterval> | null>(null);

  const initRecId = searchParams.get("recording") ? parseInt(searchParams.get("recording")!) : null;
  const initCamId = searchParams.get("camera")    ? parseInt(searchParams.get("camera")!)    : null;
  const initLive  = searchParams.get("live") === "true";

  const [selectedRecId, setSelectedRecId] = useState<number | null>(initRecId);
  const [selectedCamId, setSelectedCamId] = useState<number | null>(initCamId);
  const [liveMode, setLiveMode]           = useState(initLive || !!initCamId);
  const [playing, setPlaying]             = useState(false);
  const [muted, setMuted]                 = useState(true);
  const [currentTime, setCurrentTime]     = useState(0);
  const [duration, setDuration]           = useState(0);
  const [aiEnabled, setAiEnabled]         = useState(false);
  const [aiMode, setAiMode]               = useState("detect");
  const [detections, setDetections]       = useState<Detection[]>([]);
  const [inferenceMs, setInferenceMs]     = useState<number | null>(null);
  const [peopleCount, setPeopleCount]     = useState<number | null>(null);
  const [densityPct, setDensityPct]       = useState<number | null>(null);
  const [densityLevel, setDensityLevel]   = useState<string | null>(null);
  const [intrusionDetected, setIntrusion] = useState<boolean | null>(null);
  const [intruderCount, setIntruderCount] = useState<number | null>(null);
  const [frameCount, setFrameCount]       = useState(0);

  const { data: cameras } = useCameras();
  const { data: recordings } = useRecordings(
    selectedCamId ? { camera_id: selectedCamId, limit: 100 } : { limit: 50 }
  );

  const currentRecording = recordings?.find(r => r.recording_id === selectedRecId);
  const currentCamera    = cameras?.find(c => c.camera_id === selectedCamId);

  // ── Load HLS live stream ───────────────────────────────────────────────────
  useEffect(() => {
    if (!liveMode || !selectedCamId) return;
    const video = videoRef.current;
    if (!video) return;
    hlsRef.current?.destroy();
    const token = tokenStore.get() ?? "";
    const url = `${API_BASE}/api/streaming/hls/${selectedCamId}/stream.m3u8?token=${encodeURIComponent(token)}`;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url; video.load(); video.play().catch(() => {});
      return () => { video.src = ""; };
    }
    let cancelled = false;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !videoRef.current) return;
      if (!Hls.isSupported()) return;
      const hls = new Hls({ enableWorker: false, lowLatencyMode: true, backBufferLength: 30 });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.MANIFEST_PARSED, () => videoRef.current?.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_: any, d: any) => {
        if (d.fatal) toast({ title: "Stream not ready yet — recorder starts in up to 60s", variant: "destructive" });
      });
    });
    return () => { cancelled = true; hlsRef.current?.destroy(); };
  }, [liveMode, selectedCamId]);

  // ── Load MP4 recording ─────────────────────────────────────────────────────
  useEffect(() => {
    if (liveMode || !selectedRecId) return;
    const video = videoRef.current;
    if (!video) return;
    hlsRef.current?.destroy();
    video.src = getStreamUrl(selectedRecId);
    video.load();
  }, [selectedRecId, liveMode]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };
  const skip = (s: number) => { if (videoRef.current) videoRef.current.currentTime += s; };

  // ── AI inference ────────────────────────────────────────────────────────────
  const runAi = useCallback(async () => {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!v || !canvas || v.paused || v.ended || v.videoWidth === 0) return;

    const tmp = document.createElement("canvas");
    tmp.width = v.videoWidth; tmp.height = v.videoHeight;
    tmp.getContext("2d")?.drawImage(v, 0, 0);

    const mode = AI_MODES.find(m => m.key === aiMode)!;
    tmp.toBlob(async (blob) => {
      if (!blob) return;
      try {
        const res = await detectObjects(blob, { conf: 0.35, endpoint: mode.endpoint });
        setDetections(res.detections);
        setInferenceMs(res.inference_ms);
        setFrameCount(c => c + 1);
        if (res.people_count !== undefined)      setPeopleCount(res.people_count);
        if (res.density_percent !== undefined)   setDensityPct(res.density_percent);
        if (res.density_level !== undefined)     setDensityLevel(res.density_level);
        if (res.intrusion_detected !== undefined){ setIntrusion(res.intrusion_detected); setIntruderCount(res.intruder_count ?? 0); }

        // Draw overlay
        canvas.width = tmp.width; canvas.height = tmp.height;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        res.detections.forEach((d: Detection) => {
          const [x1,y1,x2,y2] = d.bbox;
          const col = boxColor(d.label);
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          ctx.strokeRect(x1,y1,x2-x1,y2-y1);
          const lbl = `${d.label} ${(d.confidence*100).toFixed(0)}%`;
          ctx.font = "bold 12px system-ui";
          const tw = ctx.measureText(lbl).width + 6;
          ctx.fillStyle = col + "cc"; ctx.fillRect(x1,y1-18,tw,18);
          ctx.fillStyle = "#000"; ctx.fillText(lbl,x1+3,y1-4);
        });
        // Density bar
        if (mode.key === "people" && res.people_count) {
          const dp = res.density_percent ?? 0;
          const col = res.density_level==="HIGH"?"#ef4444":res.density_level==="MEDIUM"?"#f59e0b":"#22c55e";
          ctx.fillStyle = col+"99"; ctx.fillRect(0,canvas.height-8,(dp/100)*canvas.width,8);
          ctx.fillStyle="#ffffffdd"; ctx.font="bold 13px system-ui";
          ctx.fillText(`${res.people_count} people · ${res.density_level} ${dp}%`,8,canvas.height-12);
        }
      } catch {}
    }, "image/jpeg", 0.75);
  }, [aiMode]);

  useEffect(() => {
    if (aiEnabled) { aiTimer.current = setInterval(runAi, 2000); }
    else {
      if (aiTimer.current) clearInterval(aiTimer.current);
      setDetections([]); setInferenceMs(null); setPeopleCount(null);
      setDensityPct(null); setDensityLevel(null); setIntrusion(null); setIntruderCount(null);
      setFrameCount(0);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && canvasRef.current) ctx.clearRect(0,0,canvasRef.current.width,canvasRef.current.height);
    }
    return () => { if (aiTimer.current) clearInterval(aiTimer.current); };
  }, [aiEnabled, runAi]);

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Video Player</h1>
            <p className="text-sm text-muted-foreground">
              {liveMode ? "Live stream (HLS from recorder)" : "Recording playback"} · Real-time AI overlay
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant={liveMode ? "default" : "outline"} size="sm" onClick={() => setLiveMode(true)}>Live</Button>
            <Button variant={!liveMode ? "default" : "outline"} size="sm" onClick={() => setLiveMode(false)}>Recordings</Button>
          </div>
        </div>

        <div className="grid xl:grid-cols-4 gap-4">
          {/* ── Video area ─────────────────────────────────────────────────── */}
          <div className="xl:col-span-3 space-y-3">
            <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
              <video ref={videoRef} className="w-full h-full object-contain"
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                onTimeUpdate={e => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                onLoadedMetadata={e => setDuration((e.target as HTMLVideoElement).duration)}
                muted={muted} playsInline />
              {aiEnabled && (
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{ objectFit: "contain" }} />
              )}
              {/* AI badge overlay */}
              {aiEnabled && (
                <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                  <Badge className="bg-black/70 text-ai-glow border-ai-glow/30 gap-1 text-[10px]">
                    <Cpu className="h-2.5 w-2.5 animate-pulse" />
                    {AI_MODES.find(m => m.key === aiMode)?.label}
                    {inferenceMs ? ` · ${inferenceMs}ms` : ""}
                  </Badge>
                  {aiMode === "people" && peopleCount !== null && (
                    <Badge className="bg-black/70 text-green-400 border-green-500/30 text-[10px]">
                      <Users className="h-2.5 w-2.5 mr-1" />{peopleCount} people
                    </Badge>
                  )}
                  {intrusionDetected && (
                    <Badge className="bg-red-500/80 text-white text-[10px] animate-pulse">
                      <ShieldAlert className="h-2.5 w-2.5 mr-1" />INTRUSION
                    </Badge>
                  )}
                </div>
              )}
              {/* No source */}
              {!selectedRecId && !selectedCamId && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                  <Camera className="h-14 w-14 mb-3 opacity-20" />
                  <p className="text-sm">Select a camera or recording →</p>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {!liveMode && duration > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground w-10">
                  {Math.floor(currentTime/60)}:{String(Math.floor(currentTime%60)).padStart(2,"0")}
                </span>
                <input type="range" min={0} max={duration} value={currentTime} step={0.5}
                  className="flex-1 accent-primary h-1.5"
                  onChange={e => { if (videoRef.current) videoRef.current.currentTime = parseFloat(e.target.value); }} />
                <span className="text-[10px] font-mono text-muted-foreground w-10 text-right">
                  {Math.floor(duration/60)}:{String(Math.floor(duration%60)).padStart(2,"0")}
                </span>
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {!liveMode && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => skip(-10)}><SkipBack className="h-4 w-4" /></Button>}
              <Button size="icon" className="h-8 w-8" onClick={togglePlay}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              {!liveMode && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => skip(10)}><SkipForward className="h-4 w-4" /></Button>}
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setMuted(!muted)}>
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Separator orientation="vertical" className="h-6 mx-1" />
              <Select value={aiMode} onValueChange={v => { setAiMode(v); setFrameCount(0); }}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <Cpu className="h-3 w-3 mr-1.5 text-ai-glow shrink-0" /><SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_MODES.map(m => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant={aiEnabled ? "default" : "outline"} size="sm" className="h-8 gap-1.5"
                onClick={() => setAiEnabled(!aiEnabled)}>
                <Bot className="h-3.5 w-3.5" />{aiEnabled ? "AI ON" : "Enable AI"}
              </Button>
              {selectedRecId && (
                <Button size="sm" variant="ghost" className="h-8 gap-1 ml-auto" asChild>
                  <a href={getDownloadUrl(selectedRecId)} download><Download className="h-3.5 w-3.5" />Download</a>
                </Button>
              )}
            </div>

            {/* Info card */}
            {(currentRecording || (currentCamera && liveMode)) && (
              <Card className="bg-card border-border">
                <CardContent className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {currentRecording && !liveMode && <>
                    <div><p className="text-muted-foreground">Camera</p><p className="font-medium">{currentRecording.camera_name}</p></div>
                    <div><p className="text-muted-foreground">IP Address</p><p className="font-mono">{currentRecording.ip_address || "—"}</p></div>
                    <div><p className="text-muted-foreground">Started</p><p className="font-mono">{format(new Date(currentRecording.start_timestamp),"dd MMM HH:mm:ss")}</p></div>
                    <div><p className="text-muted-foreground">Duration</p><p>{currentRecording.duration_seconds ? `${Math.floor(currentRecording.duration_seconds/60)}m ${currentRecording.duration_seconds%60}s` : "—"}</p></div>
                    <div><p className="text-muted-foreground">Codec</p><p>{currentRecording.video_codec} · {currentRecording.resolution_width}×{currentRecording.resolution_height}</p></div>
                    {currentRecording.gps_speed_kmh && <div><p className="text-muted-foreground">Speed</p><p>🚂 {currentRecording.gps_speed_kmh} km/h</p></div>}
                  </>}
                  {currentCamera && liveMode && <>
                    <div><p className="text-muted-foreground">Camera</p><p className="font-medium">{currentCamera.camera_name}</p></div>
                    <div><p className="text-muted-foreground">IP Address</p><p className="font-mono">{currentCamera.ip_address || "—"}</p></div>
                    <div><p className="text-muted-foreground">Location</p><p>{currentCamera.location_description || currentCamera.camera_type}</p></div>
                    <div><p className="text-muted-foreground">UDP Port</p><p className="font-mono">{5000 + currentCamera.camera_id * 2} (mNVR core)</p></div>
                  </>}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Sidebar ────────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <AiPanel detections={detections} inferenceMs={inferenceMs}
              peopleCount={peopleCount} densityPct={densityPct} densityLevel={densityLevel}
              intrusionDetected={intrusionDetected} intruderCount={intruderCount}
              frameCount={frameCount} aiMode={aiMode} />

            {/* Cameras */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Cameras</CardTitle></CardHeader>
              <CardContent className="p-2 pt-0 max-h-36 overflow-y-auto space-y-0.5">
                {cameras?.map(cam => (
                  <button key={cam.camera_id}
                    onClick={() => { setSelectedCamId(cam.camera_id); setLiveMode(true); setSelectedRecId(null); }}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-start gap-2 transition-colors hover:bg-muted/50 ${selectedCamId===cam.camera_id?"bg-primary/10 border border-primary/30":""}`}>
                    <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${cam.status==="ACTIVE"?"bg-green-400":"bg-gray-400"}`} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{cam.camera_name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{cam.ip_address || "—"}</p>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Recordings */}
            {!liveMode && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Recordings {recordings?.length ? `(${recordings.length})` : ""}</CardTitle></CardHeader>
                <CardContent className="p-2 pt-0 max-h-64 overflow-y-auto space-y-0.5">
                  {!recordings?.length && <p className="text-[11px] text-muted-foreground text-center py-4">Recordings appear after first 60s segment</p>}
                  {recordings?.map(rec => (
                    <button key={rec.recording_id}
                      onClick={() => { setSelectedRecId(rec.recording_id); setLiveMode(false); }}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted/50 transition-colors border ${selectedRecId===rec.recording_id?"bg-primary/10 border-primary/30":"border-transparent"}`}>
                      <p className="font-medium truncate">{rec.camera_name || `Camera ${rec.camera_id}`}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(rec.start_timestamp),"dd MMM HH:mm")}
                        {rec.duration_seconds ? ` · ${Math.floor(rec.duration_seconds/60)}m` : ""}
                      </p>
                      {rec.ip_address && <p className="text-[10px] font-mono text-muted-foreground">{rec.ip_address}</p>}
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};
export default VideoPlayer;
