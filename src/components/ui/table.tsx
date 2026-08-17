import type { ReactNode } from "react";
import { EmptyState } from "./empty";

export interface Column<T> {
  key: string;
  header: string;
  /** Cell contents. Return a string and it renders as-is. */
  cell: (row: T) => ReactNode;
  /** Right-align numeric columns. */
  align?: "left" | "right";
  /** Hide below the `sm` breakpoint — tables get cramped on phones. */
  hideOnMobile?: boolean;
}

/**
 * The raw `<table>` markup currently repeated across seven pages.
 *
 * Horizontal overflow scrolls inside the table rather than the page, so a wide
 * table never makes the whole layout scroll sideways on a phone.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "Nothing here yet.",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: string;
}) {
  if (rows.length === 0) return <EmptyState message={empty} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-full text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-ink-faint ${
                  c.align === "right" ? "text-right" : "text-left"
                } ${c.hideOnMobile ? "hidden sm:table-cell" : ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className="border-t border-line transition-colors hover:bg-raised"
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 text-[13px] text-ink ${
                    c.align === "right" ? "text-right" : "text-left"
                  } ${c.hideOnMobile ? "hidden sm:table-cell" : ""}`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
