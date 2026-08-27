"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/*
 * The client half of live updates.
 *
 * <LiveUpdates /> is mounted once in the signed-in shell. It holds one
 * EventSource on /api/events per tab. When the server says something changed:
 *
 *   1. the event is re-broadcast in-page as a `n1:live-change` CustomEvent, so
 *      components that fetch their own data (dashboard day panel, bell,
 *      messages, approvals…) can re-fetch via `useLiveEvent`, and
 *   2. `router.refresh()` re-renders the current server-component page — which
 *      makes every ordinary screen live with zero per-screen work.
 *
 * Refreshes are debounced, and skipped while the tab is hidden (one catch-up
 * refresh fires when it becomes visible again). If the stream cannot connect,
 * it retries with backoff; the app is never worse off than without it.
 */

const EVENT_NAME = "n1:live-change";
const REFRESH_DEBOUNCE_MS = 400;
const MAX_RETRY_MS = 30_000;

export function LiveUpdates() {
  const router = useRouter();
  // The latest router without re-running the stream effect on every render.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    /** Set while a refresh is waiting for an open dialog to close. */
    let modalTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let hiddenMissedRefresh = false;
    let closed = false;

    /**
     * ⚠ Never refresh the page out from under an open dialog.
     *
     * `router.refresh()` re-runs the server components above every client
     * component, and doing that beneath a modal discards the conversation
     * inside it: the day-plan chat lost the person's answer and the
     * acknowledgement of it about 400ms after they tapped — the debounce
     * below, firing on the very change their own answer had just published.
     *
     * The same protection covers every other modal in the app: a course
     * detail, a meeting form, a figure breakdown, the clock-in gate. A
     * background update is never worth interrupting something the person is
     * in the middle of, so it waits and lands the moment they are done.
     */
    const doRefresh = () => {
      if (document.visibilityState === "hidden") {
        hiddenMissedRefresh = true;
        return;
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        if (modalTimer) clearTimeout(modalTimer);
        modalTimer = setTimeout(doRefresh, 1200);
        return;
      }
      routerRef.current.refresh();
    };

    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        doRefresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && hiddenMissedRefresh) {
        hiddenMissedRefresh = false;
        doRefresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const connect = () => {
      if (closed) return;
      source = new EventSource("/api/events");
      source.addEventListener("change", (ev) => {
        failures = 0;
        let areas: string[] = [];
        try {
          areas = (JSON.parse((ev as MessageEvent).data) as { areas?: string[] }).areas ?? [];
        } catch {
          /* a malformed frame still means "something changed" */
        }
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { areas } }));
        scheduleRefresh();
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (closed) return;
        failures += 1;
        const wait = Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(failures, 5));
        retryTimer = setTimeout(connect, wait);
      };
    };
    connect();

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (modalTimer) clearTimeout(modalTimer);
    };
  }, []);

  return null;
}

/**
 * Re-run `fn` (debounced) whenever a live change arrives — optionally only for
 * certain areas. Used by components that fetch their own data instead of
 * relying on the page-level refresh.
 */
export function useLiveEvent(
  fn: () => void,
  options?: { areas?: string[]; debounceMs?: number },
) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const areasKey = options?.areas?.join(",") ?? "";
  const debounceMs = options?.debounceMs ?? 500;

  useEffect(() => {
    const wanted = areasKey ? areasKey.split(",") : null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = (ev: Event) => {
      if (wanted) {
        const got = (ev as CustomEvent<{ areas?: string[] }>).detail?.areas ?? [];
        // "assistant" is a coarse signal — a chat/voice turn may have written
        // anywhere — so every filtered listener accepts it too.
        if (!got.some((a) => a === "assistant" || wanted.includes(a))) return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fnRef.current();
      }, debounceMs);
    };
    window.addEventListener(EVENT_NAME, onChange);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
      if (timer) clearTimeout(timer);
    };
  }, [areasKey, debounceMs]);
}
