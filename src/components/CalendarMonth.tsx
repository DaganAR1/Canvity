"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDay, CalendarItem, MonthGrid, formatMonthParam, shiftMonth } from "@/lib/calendar";
import { formatAllDay, formatInZone } from "@/lib/timezone";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Priority reads as a colour ramp: red is genuinely urgent, slate is filler.
// Canvas shows every due date in the same flat colour, which is precisely why
// it's hard to tell a midterm from a discussion post at a glance.
const TIER_STYLES: Record<string, { bar: string; text: string }> = {
  critical: { bar: "bg-red-500", text: "text-red-700 dark:text-red-300" },
  high: { bar: "bg-orange-500", text: "text-orange-700 dark:text-orange-300" },
  normal: { bar: "bg-blue-500", text: "text-blue-700 dark:text-blue-300" },
  low: { bar: "bg-slate-400", text: "text-slate-600 dark:text-slate-400" },
  done: { bar: "bg-green-500", text: "text-green-700 dark:text-green-400" },
};

const SOURCE_LABEL: Record<string, string> = {
  assignment: "Assignment",
  syllabus: "From syllabus",
  study: "Study block",
};

export default function CalendarMonth({ grid, timeZone }: { grid: MonthGrid; timeZone: string }) {
  const [selected, setSelected] = useState<CalendarDay | null>(null);

  const prev = shiftMonth(grid.year, grid.month, -1);
  const next = shiftMonth(grid.year, grid.month, 1);
  const totalItems = grid.weeks.flat().reduce((sum, d) => sum + (d.inMonth ? d.items.length : 0), 0);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {MONTH_NAMES[grid.month - 1]} {grid.year}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {totalItems === 0 ? "Nothing scheduled this month." : `${totalItems} items this month.`}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Link
            href={`/calendar?month=${formatMonthParam(prev.year, prev.month)}`}
            aria-label="Previous month"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-slate-800"
          >
            ←
          </Link>
          <Link
            href="/calendar"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm font-medium hover:bg-blue-50 dark:hover:bg-slate-800"
          >
            Today
          </Link>
          <Link
            href={`/calendar?month=${formatMonthParam(next.year, next.month)}`}
            aria-label="Next month"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-sm hover:bg-blue-50 dark:hover:bg-slate-800"
          >
            →
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 gap-px rounded-t-xl border border-b-0 border-[var(--border)] bg-[var(--border)] text-center text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {WEEKDAYS.map((d) => (
              <div key={d} className="bg-[var(--card)] py-2">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px rounded-b-xl border border-[var(--border)] bg-[var(--border)] overflow-hidden">
            {grid.weeks.flat().map((day) => (
              <button
                key={day.dayIndex}
                onClick={() => day.items.length > 0 && setSelected(day)}
                className={`min-h-[104px] p-1.5 text-left align-top transition ${
                  day.inMonth ? "bg-[var(--card)]" : "bg-[var(--background)]"
                } ${day.items.length > 0 ? "cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-800" : "cursor-default"}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-medium ${
                      day.isToday
                        ? "bg-blue-600 text-white"
                        : day.inMonth
                          ? "text-[var(--foreground)]"
                          : "text-[var(--muted)] opacity-60"
                    }`}
                  >
                    {day.day}
                  </span>
                  {day.items.length > 3 && (
                    <span className="text-[10px] text-[var(--muted)]">{day.items.length}</span>
                  )}
                </div>

                <div className="space-y-0.5">
                  {day.items.slice(0, 3).map((item) => {
                    const tier = TIER_STYLES[item.priorityTier] ?? TIER_STYLES.normal;
                    return (
                      <div
                        key={item.id}
                        title={`${item.title}${item.courseCode ? ` · ${item.courseCode}` : ""}`}
                        className={`flex items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight ${
                          item.isDone ? "opacity-45" : ""
                        }`}
                      >
                        <span className={`h-3 w-0.5 shrink-0 rounded-full ${tier.bar}`} aria-hidden />
                        <span className={`truncate ${item.isDone ? "line-through" : ""}`}>{item.title}</span>
                      </div>
                    );
                  })}
                  {day.items.length > 3 && (
                    <div className="px-1 text-[10px] text-[var(--muted)]">+{day.items.length - 3} more</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {selected && <DayDetail day={selected} timeZone={timeZone} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DayDetail({
  day,
  timeZone,
  onClose,
}: {
  day: CalendarDay;
  timeZone: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-semibold">
            {MONTH_NAMES[day.month - 1]} {day.day}, {day.year}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-[var(--muted)] hover:text-blue-600">
            ✕
          </button>
        </div>

        <ul className="space-y-3">
          {day.items.map((item) => {
            const tier = TIER_STYLES[item.priorityTier] ?? TIER_STYLES.normal;
            return (
              <li key={item.id} className="flex gap-2.5">
                <span className={`mt-1 h-full w-0.5 shrink-0 rounded-full ${tier.bar}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-sm font-medium hover:text-blue-600 hover:underline ${item.isDone ? "line-through opacity-60" : ""}`}
                      >
                        {item.title}
                      </a>
                    ) : (
                      <span className={`text-sm font-medium ${item.isDone ? "line-through opacity-60" : ""}`}>
                        {item.title}
                      </span>
                    )}
                    <span className={`shrink-0 text-[11px] font-semibold uppercase ${tier.text}`}>
                      {item.isDone ? "Done" : item.priorityTier}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {[item.courseCode || item.courseName, formatItemTime(item, timeZone), SOURCE_LABEL[item.source]]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** All-day items have no real clock time, so showing one would be a fiction. */
function formatItemTime(item: CalendarItem, timeZone: string): string {
  if (!item.date) return "";
  const date = new Date(item.date);
  if (item.isAllDay) return formatAllDay(date, { month: "short", day: "numeric" });
  return formatInZone(date, timeZone, { hour: "numeric", minute: "2-digit" });
}
