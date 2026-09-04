// Timezone helpers built on Intl, so the same instant resolves to the same
// local calendar day on the server and in the browser. Everything downstream
// (timeline buckets, digest scheduling, notification text) depends on that
// agreement — without it, server-rendered HTML and the hydrated client disagree
// about what "today" means.

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
}

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = FORMATTER_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    FORMATTER_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

/** Falls back to UTC rather than throwing on an unrecognized zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl can report midnight as hour 24 under hour12:false.
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** The wall-clock hour in the given zone — what a "send at 7am" setting means. */
export function zonedHour(date: Date, timeZone: string): number {
  return getZonedParts(date, timeZone).hour;
}

/**
 * A day number for calendar arithmetic: days since the epoch for a Y-M-D,
 * independent of any zone. Comparing two of these answers "how many calendar
 * days apart", which is what the timeline buckets actually care about.
 */
export function dayIndexFromParts(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** The calendar day the instant falls on, as seen from the given zone. */
export function dayIndexInZone(date: Date, timeZone: string): number {
  const { year, month, day } = getZonedParts(date, timeZone);
  return dayIndexFromParts(year, month, day);
}

/** Inverse of `dayIndexFromParts` — turns a day number back into a calendar date. */
export function partsFromDayIndex(dayIndex: number): { year: number; month: number; day: number } {
  const d = new Date(dayIndex * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Day of the week for a calendar date: 0 = Sunday .. 6 = Saturday. */
export function weekdayFromParts(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The calendar day a date-only value represents. Such values are stored at UTC
 * midnight and mean a calendar date, not an instant, so they are read back in
 * UTC no matter where the reader is.
 */
export function dayIndexOfAllDay(date: Date): number {
  return dayIndexFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Converts a naive wall-clock time ("2pm on Dec 15", with no zone attached) to
 * the real UTC instant it means in the given zone. This is how a syllabus's
 * "2pm" — which nobody writes with a UTC offset — turns into an actual instant:
 * interpreted as 2pm in the course owner's zone, not 2pm UTC.
 *
 * Standard offset-correction approach: guess the instant assuming UTC, read
 * back what wall-clock time that guess actually shows in the target zone, and
 * shift by the difference. Settles in one pass except within the hour of a DST
 * transition, where the shown wall-clock time can be ambiguous or skipped
 * entirely — an acceptable, well-known limitation shared by every zone library
 * that doesn't ship the full tz transition table.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  const guess = new Date(wanted);
  const shown = getZonedParts(guess, timeZone);
  const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
  return new Date(wanted + (wanted - shownAsUtc));
}

/** Formats an instant as it would read on a clock in the given zone. */
export function formatInZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale = "en-US"
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
}

/**
 * Formats a date-only value as its calendar date. Read in UTC to match how such
 * values are stored — formatting one in a western zone would otherwise show the
 * previous day.
 */
export function formatAllDay(date: Date, options: Intl.DateTimeFormatOptions, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
}
