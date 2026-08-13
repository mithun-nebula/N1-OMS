"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "inverted" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-teal-700 text-white hover:bg-teal-800",
  inverted:
    "bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200",
  ghost:
    "border border-black/[.1] text-zinc-600 hover:border-black/[.25] dark:border-white/[.2] dark:text-zinc-300 dark:hover:border-white/[.4]",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1 text-xs",
  md: "px-4 py-1.5 text-sm",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a working label and disables the button. */
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  busyLabel,
  disabled,
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={`rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {busy ? (busyLabel ?? "Working…") : children}
    </button>
  );
}
