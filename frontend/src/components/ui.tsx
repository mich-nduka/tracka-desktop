import React, { useState } from "react";
import { type LucideIcon } from "lucide-react";
import { IconChip, getAccent } from "@/components/IconChip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// Re-export core shadcn primitives
export { Button } from "@/components/ui/button";
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
export { Input } from "@/components/ui/input";
export { Textarea } from "@/components/ui/textarea";
export { Badge, FilterChip } from "@/components/ui/badge";
export { SegmentedControl as Segmented } from "@/components/ui/tabs";
export { Field } from "@/components/fields";

/**
 * Circular action button (used in Timer and quick actions)
 */
export function CircleButton({
  icon,
  onClick,
  size = 64,
  variant = "primary",
  disabled,
  title,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  size?: number;
  variant?: "primary" | "danger" | "secondary";
  disabled?: boolean;
  title?: string;
}) {
  const bg =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:opacity-90"
      : variant === "danger"
        ? "bg-[#7f1d1d] text-white hover:bg-[#991b1b]"
        : "bg-[#27272a] text-foreground hover:bg-zinc-700";

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{ width: size, height: size }}
      className={`rounded-full flex items-center justify-center shadow-md transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${bg}`}
    >
      {icon}
    </button>
  );
}

/**
 * EmptyState matching mobile kit (icon chip, title, description, and action)
 */
export function EmptyState({
  title,
  message,
  action,
  icon = "sparkles",
}: {
  title: string;
  message?: string;
  action?: React.ReactNode;
  icon?: string | LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-12 border border-dashed border-border rounded-2xl bg-card/40 my-2">
      <IconChip icon={icon} size={64} background="#27272a" color="#a1a1aa" />
      <h3 className="font-semibold text-base mt-4 text-foreground">{title}</h3>
      {message ? (
        <p className="text-xs text-muted-foreground mt-1.5 max-w-sm">{message}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Legacy alias */
export const Empty = EmptyState;

/**
 * Base UI-powered modal wrapper
 */
export function Modal({
  children,
  onClose,
  wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent wide={wide}>{children}</DialogContent>
    </Dialog>
  );
}

/**
 * Base UI-powered Confirm dialog
 */
export function Confirm({
  title,
  message,
  confirmLabel = "Delete",
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent hideClose className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mt-2 text-sm">{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Avatar updated to use circular IconChip and student accents
 */
export function Avatar({
  id,
  name,
  size = 40,
}: {
  id: string;
  name: string;
  size?: number;
}) {
  const accent = getAccent(id);
  return (
    <IconChip icon="school" accent={accent} size={size} />
  );
}

/**
 * Stable per-student accent color helper
 */
export function accentFor(id: string): string {
  return getAccent(id).main;
}

/**
 * Toast notifications
 */
export function useToasts() {
  const [items, setItems] = useState<{ id: number; message: string; isError: boolean }[]>([]);

  React.useEffect(() => {
    let next = 1;
    const handler = (e: Event) => {
      const { message, isError } = (e as CustomEvent).detail;
      const id = next++;
      setItems((xs) => [...xs, { id, message, isError }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500);
    };
    window.addEventListener("tracka-toast", handler);
    return () => window.removeEventListener("tracka-toast", handler);
  }, []);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col gap-2 z-50 pointer-events-none no-print">
      {items.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-2.5 rounded-lg border text-xs font-medium shadow-2xl pointer-events-auto transition-all animate-in fade-in-0 slide-in-from-bottom-2 ${
            t.isError
              ? "bg-[#1c1c1f] text-red-200 border-red-500/50"
              : "bg-[#1c1c1f] text-foreground border-zinc-700"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
