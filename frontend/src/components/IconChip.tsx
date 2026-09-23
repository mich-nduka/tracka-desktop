import React from "react";
import {
  GraduationCap,
  Timer,
  PenLine,
  Users,
  Flower2,
  Sparkles,
  CloudUpload,
  CloudCheck,
  CloudOff,
  AlertCircle,
  Info,
  Calendar,
  FileText,
  Check,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface Accent {
  main: string;
  soft: string;
  onSoft: string;
}

export const Accents: Accent[] = [
  { main: "#2662D9", soft: "#27272A", onSoft: "#7AA7F4" },
  { main: "#2EB88A", soft: "#27272A", onSoft: "#5ED4AC" },
  { main: "#E88C30", soft: "#27272A", onSoft: "#F2AE66" },
  { main: "#AF57DB", soft: "#27272A", onSoft: "#C88AE7" },
  { main: "#E23670", soft: "#27272A", onSoft: "#EC6F98" },
];

export function getAccent(id: string): Accent {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Accents[Math.abs(hash) % Accents.length];
}

const ICON_MAP: Record<string, LucideIcon> = {
  school: GraduationCap,
  stopwatch: Timer,
  timer: Timer,
  create: PenLine,
  people: Users,
  flower: Flower2,
  sparkles: Sparkles,
  "cloud-upload": CloudUpload,
  "cloud-done": CloudCheck,
  "cloud-offline": CloudOff,
  "alert-circle": AlertCircle,
  "information-circle": Info,
  calendar: Calendar,
  document: FileText,
  check: Check,
  close: X,
};

export function IconChip({
  icon,
  accent,
  size = 40,
  background,
  color,
  className,
}: {
  icon: keyof typeof ICON_MAP | LucideIcon | React.ReactNode;
  accent?: Accent;
  size?: number;
  background?: string;
  color?: string;
  className?: string;
}) {
  const bg = background ?? accent?.soft ?? "#27272A";
  const iconColor = color ?? accent?.onSoft ?? "#FAFAFA";
  const iconSize = Math.round(size * 0.48);

  let IconComponent: React.ReactNode = null;
  if (typeof icon === "string" && ICON_MAP[icon]) {
    const Component = ICON_MAP[icon];
    IconComponent = <Component size={iconSize} color={iconColor} />;
  } else if (typeof icon === "function") {
    const Component = icon as LucideIcon;
    IconComponent = <Component size={iconSize} color={iconColor} />;
  } else if (React.isValidElement(icon)) {
    IconComponent = icon;
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center shrink-0 select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
      }}
    >
      {IconComponent}
    </div>
  );
}
