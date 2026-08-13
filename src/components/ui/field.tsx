"use client";

import type { ReactNode } from "react";

const INPUT =
  "w-full rounded-lg border border-black/[.12] px-3 py-1.5 text-sm text-black outline-none focus:border-teal-600 disabled:opacity-50 dark:border-white/[.2] dark:bg-black dark:text-zinc-50";

function Wrapper({
  label,
  error,
  hint,
  children,
}: {
  label?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-400">
          {label}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-rose-600">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-zinc-400">{hint}</span>
      )}
    </label>
  );
}

interface FieldBase {
  label?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

export function TextField({
  value,
  onChange,
  placeholder,
  type = "text",
  ...rest
}: FieldBase & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "email" | "number";
}) {
  return (
    <Wrapper {...rest}>
      <input
        type={type}
        value={value}
        disabled={rest.disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </Wrapper>
  );
}

export function DateField({
  value,
  onChange,
  ...rest
}: FieldBase & { value: string; onChange: (value: string) => void }) {
  return (
    <Wrapper {...rest}>
      <input
        type="date"
        value={value}
        disabled={rest.disabled}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </Wrapper>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  ...rest
}: FieldBase & {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <Wrapper {...rest}>
      <select
        value={value}
        disabled={rest.disabled}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrapper>
  );
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
  rows = 3,
  ...rest
}: FieldBase & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <Wrapper {...rest}>
      <textarea
        value={value}
        rows={rows}
        disabled={rest.disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </Wrapper>
  );
}

/** Stacked fields, one per row on mobile and `columns` across from `sm` up. */
export function FormRow({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const cols = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" };
  return (
    <div className={`grid grid-cols-1 gap-3 ${cols[columns]}`}>{children}</div>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div>;
}
