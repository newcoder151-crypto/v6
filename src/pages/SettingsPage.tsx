import { useState } from "react";
import { Settings, Save, RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSystemConfig, useUpdateConfig } from "@/hooks/use-system-config";
import { useToast } from "@/hooks/use-toast";
import { apiGet } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";

const SettingsPage = () => {
  const { data: config, isLoading } = useSystemConfig();
  const updateConfig = useUpdateConfig();
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string,string>>({});

  const { data: status } = useQuery({
    queryKey: ["system-status"],
    queryFn: () => apiGet<any>("/api/config/status"),
    refetchInterval: 30000,
  });

  const handleSave = async (key: string) => {
    if (edits[key] === undefined) return;
    try {
      await updateConfig.mutateAsync({ configKey: key, configValue: edits[key] });
      toast({ title: "Saved", description: `${key} updated` });
      setEdits(prev => { const n = {...prev}; delete n[key]; return n; });
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const editableKeys = config?.filter(c => c.is_readonly === 0) || [];
  const readonlyKeys = config?.filter(c => c.is_readonly === 1) || [];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold text-foreground">System Settings</h1>
          <p className="text-sm text-muted-foreground">mNVR system configuration</p></div>

        {/* System Status */}
        {status && (
          <Card className="bg-card border-border"><CardHeader className="pb-2"><CardTitle className="text-sm">System Status</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div><p className="text-muted-foreground">Uptime</p><p className="font-mono">{Math.floor((status.system?.uptime_seconds||0)/3600)}h {Math.floor(((status.system?.uptime_seconds||0)%3600)/60)}m</p></div>
              <div><p className="text-muted-foreground">Total Cameras</p><p>{status.cameras?.total||0}</p></div>
              <div><p className="text-muted-foreground">Active Cameras</p><p>{status.cameras?.ACTIVE||0}</p></div>
              <div><p className="text-muted-foreground">Unacked Events</p><p>{status.events?.unacknowledged||0}</p></div>
              {status.storage?.map((s: any) => (
                <div key={s.storage_id}><p className="text-muted-foreground">{s.mount_point}</p>
                  <p>{s.used_space_gb}GB / {s.total_space_gb}GB</p></div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Editable config */}
        <Card className="bg-card border-border"><CardHeader className="pb-2"><CardTitle className="text-sm">Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
            {editableKeys.map(item => (
              <div key={item.config_key} className="grid grid-cols-3 gap-2 items-end">
                <div className="col-span-1">
                  <Label className="text-xs text-muted-foreground">{item.config_key}</Label>
                  {item.description && <p className="text-[10px] text-muted-foreground">{item.description}</p>}
                </div>
                <div className="col-span-1">
                  <Input className="h-7 text-xs" value={edits[item.config_key] ?? item.config_value}
                    onChange={e => setEdits(prev => ({...prev, [item.config_key]: e.target.value}))} />
                </div>
                <Button size="sm" className="h-7 text-xs" variant={edits[item.config_key] !== undefined ? "default" : "ghost"}
                  onClick={() => handleSave(item.config_key)} disabled={edits[item.config_key] === undefined}>
                  <Save className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Readonly config */}
        <Card className="bg-card border-border"><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">System Info <Badge className="text-[10px]">Read-only</Badge></CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {readonlyKeys.map(item => (
              <div key={item.config_key} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                <span className="text-xs text-muted-foreground">{item.config_key}</span>
                <span className="text-xs font-mono">{item.config_value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};
export default SettingsPage;
