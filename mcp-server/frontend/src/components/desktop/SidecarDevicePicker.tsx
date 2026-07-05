import { Laptop } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchSidecarPreferences,
  fetchSidecarStatus,
  setSidecarPreference,
  type SidecarDevice,
} from "@/lib/sidecar-api";
import { cn } from "@/lib/utils";

const AUTO_VALUE = "__auto__";

function platformLabel(platform?: string | null) {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform || "desktop";
}

type SidecarDevicePickerProps = {
  value?: string | null;
  channel?: "chat" | "telegram" | "default";
  onChange?: (deviceId: string | null) => void;
  className?: string;
  compact?: boolean;
};

export function SidecarDevicePicker({
  value,
  channel = "chat",
  onChange,
  className,
  compact,
}: SidecarDevicePickerProps) {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["sidecar-status"],
    queryFn: fetchSidecarStatus,
    staleTime: 30_000,
  });

  const { data: pref } = useQuery({
    queryKey: ["sidecar-preferences", channel],
    queryFn: () => fetchSidecarPreferences(channel),
    staleTime: 30_000,
  });

  const saveMut = useMutation({
    mutationFn: (deviceId: string | null) =>
      deviceId
        ? setSidecarPreference({ channel, deviceId })
        : Promise.resolve(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sidecar-preferences"] });
    },
  });

  const devices = status?.devices ?? [];
  if (devices.length === 0) return null;

  const defaultDeviceId = devices.length === 1 ? devices[0].id : AUTO_VALUE;
  const effectiveValue = value ?? pref?.deviceId ?? defaultDeviceId;

  const handleChange = (next: string) => {
    const deviceId = next === AUTO_VALUE ? null : next;
    if (deviceId) {
      saveMut.mutate(deviceId);
    }
    onChange?.(deviceId);
  };

  return (
    <Select value={effectiveValue} onValueChange={handleChange}>
      <SelectTrigger
        className={cn(
          "rounded-xl border-border/60 bg-card/60 backdrop-blur-sm",
          compact ? "h-9 min-w-0 flex-1 sm:w-[min(200px,40vw)] sm:flex-none" : "h-9 w-full",
          className
        )}
      >
        <Laptop className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" />
        <SelectValue placeholder="Felix Desktop" />
      </SelectTrigger>
      <SelectContent>
        {devices.length > 1 && (
          <SelectItem value={AUTO_VALUE}>Otomatik / sor</SelectItem>
        )}
        {devices.map((d: SidecarDevice) => (
          <SelectItem key={d.id} value={d.id}>
            {d.name} ({platformLabel(d.platform ?? d.health?.platform)}){" "}
            {d.online ? "· online" : "· offline"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
