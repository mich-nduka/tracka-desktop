import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 select-none cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground font-semibold shadow hover:opacity-90 active:opacity-85",
        destructive:
          "bg-[#7f1d1d] text-white hover:bg-[#991b1b] border border-red-900/50",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-zinc-800/60",
        secondary:
          "bg-[#18181b] text-foreground border border-border hover:bg-zinc-800",
        ghost:
          "hover:bg-zinc-800/60 text-muted-foreground hover:text-foreground",
        warn:
          "bg-transparent text-[#fcd34d] border border-[#453a12] hover:bg-[#2a2109]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-7 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-8 text-base",
        icon: "h-9 w-9",
        circle: "rounded-full p-0 items-center justify-center",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
