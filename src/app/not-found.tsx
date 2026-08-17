import Link from "next/link";
import { Icon } from "./ui/icons";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base px-6">
      <div className="pop-in rounded-3xl bg-surface p-8 text-center shadow-card">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent-strong">
          <Icon name="spark" className="h-6 w-6" />
        </span>
        <div className="mt-4 text-5xl font-extrabold tracking-tight text-ink">404</div>
        <h2 className="mt-2 text-xl font-light tracking-tight text-ink">
          Nothing lives <span className="font-extrabold">here</span>
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
          That page doesn’t exist, or you don’t have access to it. The dashboard
          knows the way back.
        </p>
        <Link
          href="/dashboard"
          className="press mt-5 inline-flex items-center gap-1.5 rounded-full bg-chrome px-4 py-2 text-xs font-semibold text-chrome-ink transition-colors hover:bg-chrome-card"
        >
          Back to dashboard
          <Icon name="arrow" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
