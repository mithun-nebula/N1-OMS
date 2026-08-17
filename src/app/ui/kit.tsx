"use client";

import { Icon } from "./icons";

/*
 * Shared UI kit for the themed pages. One source for the pieces every page
 * needs, so tasks/dashboard/leave/meetings render the same entity the same
 * way instead of each page re-writing its own badge or input.
 */

/** Standard input/select styling on a raised field. */
export const inputCls =
  "rounded-xl border border-line bg-raised px-3 py-1.5 text-xs font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-ink-faint focus:border-accent-strong focus:bg-surface";

/** Page heading: light weight + one extrabold word, as everywhere else. */
export function PageTitle({
  light,
  bold,
  children,
}: {
  light: string;
  bold: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="rise flex flex-wrap items-center justify-between gap-3 px-4 pt-6 sm:px-6">
      <h1 className="text-2xl font-light tracking-tight text-ink sm:text-3xl">
        {light} <span className="font-extrabold">{bold}</span>
      </h1>
      {children}
    </header>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
      {children}
    </h2>
  );
}

/** Dark pill button — the primary action on a page. */
export function ChromeButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="press rounded-full bg-chrome px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Orange button — the commit action inside a form. */
export function AccentButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="press rounded-xl bg-accent-strong px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Initials avatar; size in px. */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-chrome-card font-bold text-accent"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      title={name}
    >
      {initials}
    </span>
  );
}

/** Overlapping avatar row with a +N overflow chip. */
export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((n, i) => (
        <span key={i} className={i === 0 ? "" : "-ml-2"} style={{ zIndex: shown.length - i }}>
          <span className="block rounded-full border-2 border-surface">
            <Avatar name={n} size={24} />
          </span>
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-2 grid h-6 w-6 place-items-center rounded-full border-2 border-surface bg-raised text-[9px] font-bold text-ink-soft">
          +{extra}
        </span>
      )}
    </span>
  );
}

/** Status pill — one mapping for every request-like entity. */
export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Pending: "bg-peach text-peach-strong",
    Approved: "bg-mint text-mint-strong",
    Declined: "bg-rose text-rose-strong",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles[status] ?? "bg-raised text-ink-faint"}`}>
      {status}
    </span>
  );
}

/** Priority pill — shared by dashboard and the task board. */
export function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    high: "bg-rose text-rose-strong",
    medium: "bg-peach text-peach-strong",
    low: "bg-raised text-ink-faint",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles[priority] ?? styles.low}`}>
      {priority}
    </span>
  );
}

/** Thin progress bar with themed track. */
export function Bar({ pct, tone = "bg-accent-strong" }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
      <div
        className={`h-full rounded-full transition-[width] duration-700 ease-out ${tone}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

/** Themed empty state. */
export function Empty({ icon = "check", text }: { icon?: Parameters<typeof Icon>[0]["name"]; text: string }) {
  return (
    <div className="fade-in mt-3 flex flex-col items-center gap-2 rounded-2xl bg-raised px-4 py-7 text-center">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent-strong">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <p className="text-xs text-ink-faint">{text}</p>
    </div>
  );
}

/**
 * Feedback surface for useOperation. Renders nothing when there is nothing to
 * say. Shows a dismissible refusal/error toast, or — when the gate parks a
 * money/people action — a confirmation bar with the server's prompt.
 */
export function OpFeedback({
  error,
  confirmation,
  busy,
  onConfirm,
  onCancel,
  onDismiss,
}: {
  error: string | null;
  confirmation: { pendingId: string; prompt: string } | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  if (confirmation) {
    return (
      <div className="sheet-up fixed bottom-20 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl border-l-[3px] border-accent-strong bg-chrome px-4 py-3 text-chrome-ink shadow-lift md:bottom-6">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-accent">
            Needs your confirmation
          </div>
          <div className="mt-0.5 text-[13px]">{confirmation.prompt}</div>
        </div>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="press shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-xs font-bold text-chrome transition-colors hover:bg-accent-strong disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="press shrink-0 text-xs text-chrome-soft transition-colors hover:text-chrome-ink"
        >
          Cancel
        </button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="sheet-up fixed bottom-20 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl border-l-[3px] border-danger bg-chrome px-4 py-3 text-chrome-ink shadow-lift md:bottom-6">
        <span className="min-w-0 flex-1 text-[13px]">{error}</span>
        <button
          onClick={onDismiss}
          className="press shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-chrome-ink transition-colors hover:bg-white/20"
        >
          OK
        </button>
      </div>
    );
  }
  return null;
}

/** Centered modal with pop-in; closes on backdrop click. */
export function Modal({
  onClose,
  children,
  wide,
}: {
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fade-in fixed inset-0 z-40 flex items-end justify-center bg-chrome-deep/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className={`pop-in max-h-[85vh] w-full ${wide ? "max-w-2xl" : "max-w-xl"} overflow-y-auto rounded-3xl bg-surface p-6 shadow-lift`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
