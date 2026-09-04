// Builds the month grid the calendar renders, and files each piece of work
// onto the day it actually falls on.
//
// Day assignment deliberately reuses the same primitives as the timeline
// (`dayIndexInZone` for real instants, `dayIndexOfAllDay` for calendar-date
// values). If the calendar and the timeline disagreed about which day
// something belongs to, one of them would be lying to the student.

import {
  dayIndexFromParts,
  dayIndexInZone,
  dayIndexOfAllDay,
  partsFromDayIndex,
  weekdayFromParts,
} from "@/lib/timezone";

export interface CalendarItem {
  id: string;
  source: "assignment" | "syllabus" | "study";
  title: string;
  courseName: string | null;
  courseCode: string | null;
  /** ISO instant, or null for something with no date at all. */
  date: string | null;
  /** True when `date` names a calendar date rather than an instant. */
  isAllDay: boolean;
  priorityTier: string;
  isDone: boolean;
  url: string | null;
  /** Study blocks only — the end of the block, so a duration can be shown. */
  endDate?: string | null;
}

export interface CalendarDay {
  dayIndex: number;
  year: number;
  month: number;
  day: number;
  /** False for the leading/trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  items: CalendarItem[];
}

export type CalendarWeek = CalendarDay[];

export interface MonthGrid {
  year: number;
  month: number;
  weeks: CalendarWeek[];
  /** Inclusive day-index bounds of the whole grid, padding included. */
  startDayIndex: number;
  endDayIndex: number;
}

/** Which calendar day an item belongs on, in the viewer's zone. */
export function dayIndexOfItem(item: CalendarItem, timeZone: string): number | null {
  if (!item.date) return null;
  const date = new Date(item.date);
  if (Number.isNaN(date.getTime())) return null;
  return item.isAllDay ? dayIndexOfAllDay(date) : dayIndexInZone(date, timeZone);
}

/**
 * Lays out a month as whole weeks running Sunday to Saturday, padded with the
 * neighbouring months' days so every row is complete — the shape every
 * wall calendar uses, and the one Canvas uses.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  timeZone: string,
  items: CalendarItem[] = [],
  now: Date = new Date()
): MonthGrid {
  const firstOfMonth = dayIndexFromParts(year, month, 1);
  // Day 0 of the following month is the last day of this one.
  const lastOfMonth = dayIndexFromParts(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 0);

  const leadingPad = weekdayFromParts(year, month, 1);
  const startDayIndex = firstOfMonth - leadingPad;

  const lastParts = partsFromDayIndex(lastOfMonth);
  const trailingPad = 6 - weekdayFromParts(lastParts.year, lastParts.month, lastParts.day);
  const endDayIndex = lastOfMonth + trailingPad;

  const todayIndex = dayIndexInZone(now, timeZone);

  const byDay = new Map<number, CalendarItem[]>();
  for (const item of items) {
    const index = dayIndexOfItem(item, timeZone);
    if (index === null) continue;
    const list = byDay.get(index) ?? [];
    list.push(item);
    byDay.set(index, list);
  }
  // Within a day, unfinished work first, then most urgent, then by time.
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
      const rank = (t: string) => TIER_RANK[t] ?? 99;
      const byTier = rank(a.priorityTier) - rank(b.priorityTier);
      if (byTier !== 0) return byTier;
      return (a.date ?? "").localeCompare(b.date ?? "");
    });
  }

  const weeks: CalendarWeek[] = [];
  let week: CalendarWeek = [];

  for (let index = startDayIndex; index <= endDayIndex; index++) {
    const { year: y, month: m, day: d } = partsFromDayIndex(index);
    const weekday = weekdayFromParts(y, m, d);

    week.push({
      dayIndex: index,
      year: y,
      month: m,
      day: d,
      inMonth: m === month && y === year,
      isToday: index === todayIndex,
      isWeekend: weekday === 0 || weekday === 6,
      items: byDay.get(index) ?? [],
    });

    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) weeks.push(week);

  return { year, month, weeks, startDayIndex, endDayIndex };
}

const TIER_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  done: 4,
};

/** Steps a year/month pair by whole months, rolling the year over. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/** Parses a "YYYY-MM" URL parameter, falling back to the current month. */
export function parseMonthParam(
  value: string | undefined,
  timeZone: string,
  now: Date = new Date()
): { year: number; month: number } {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12 && year >= 1970 && year <= 2999) return { year, month };
  }
  const { year, month } = partsFromDayIndex(dayIndexInZone(now, timeZone));
  return { year, month };
}

export function formatMonthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
