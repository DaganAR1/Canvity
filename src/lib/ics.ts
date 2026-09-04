// Parser for the iCalendar feed Canvas exposes at Calendar -> "Calendar Feed".
//
// This is the only route to a student's coursework that needs no access token
// and no administrator involvement — the feed URL is a secret link the student
// copies themselves. Many institutions disable student token generation
// entirely, so for those students this is the only way in.
//
// It carries less than the REST API does: assignment names, due dates, course
// codes and links, but no point values, group weights, or submission status.

import { isValidTimeZone, safeTimeZone, zonedTimeToUtc } from "@/lib/timezone";

export interface IcsEvent {
  /** Stable identifier from the feed, used to avoid duplicating on re-sync. */
  uid: string;
  title: string;
  /** Null when the event carried no usable date. */
  date: Date | null;
  /** True when the feed gave a date with no time of day (VALUE=DATE). */
  isAllDay: boolean;
  description: string | null;
  url: string | null;
  /** Course code parsed out of the summary, e.g. "CHEM 232". */
  courseCode: string | null;
  /** Canvas course id, recovered from the event URL when present. */
  canvasCourseId: string | null;
  /** Canvas assignment id, recovered from the event URL when present. */
  canvasAssignmentId: string | null;
  /** Assignments have consequences; plain calendar events mostly don't. */
  isAssignment: boolean;
}

/**
 * iCalendar folds long lines by inserting CRLF followed by a single space or
 * tab. Unfolding has to happen before anything else or values silently split
 * mid-word — long assignment titles are exactly where this bites.
 */
function unfoldLines(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "");
}

/** Splits `NAME;PARAM=VALUE:the value` into its name, params and value. */
function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");

  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq !== -1) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }

  return { name: name.toUpperCase(), params, value };
}

/** Reverses the escaping iCalendar applies to text values. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Parses an iCalendar date value. Four shapes appear in practice:
 *
 *   20260904T235900Z                     — an absolute UTC instant
 *   DTSTART;TZID=America/New_York:...    — wall-clock time in a named zone
 *   20260904T235900                      — "floating" time, meaning whatever
 *                                          local time the reader is in
 *   20260904 (VALUE=DATE)                — a calendar date, no time at all
 *
 * The TZID and floating cases both need a zone to resolve against, and getting
 * that wrong shifts a deadline by the whole UTC offset — enough to make work
 * due tonight read as already overdue. Floating values fall back to the
 * viewer's own zone, which is what the spec intends by "local time".
 */
export function parseIcsDate(
  value: string,
  params: Record<string, string> = {},
  fallbackTimeZone = "UTC"
): { date: Date | null; isAllDay: boolean } {
  const v = value.trim();

  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return { date: null, isAllDay: true };
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return { date: Number.isNaN(date.getTime()) ? null : date, isAllDay: true };
  }

  // Seconds are optional; some producers emit only HHMM.
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/);
  if (!m) return { date: null, isAllDay: false };

  const [, y, mo, d, h, min, sec, zulu] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(min);
  const second = Number(sec ?? "0");

  if (zulu === "Z") {
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return { date: Number.isNaN(date.getTime()) ? null : date, isAllDay: false };
  }

  // Wall-clock time: resolve against the event's own zone when it names one,
  // otherwise the viewer's.
  const zone = params.TZID && isValidTimeZone(params.TZID) ? params.TZID : safeTimeZone(fallbackTimeZone);
  const date = zonedTimeToUtc(year, month, day, hour, minute, zone);
  return { date: Number.isNaN(date.getTime()) ? null : date, isAllDay: false };
}

/**
 * Canvas puts the course code in trailing brackets: "Problem Set 7 [CHEM 232]".
 * Only the last bracketed group is treated as the course, since assignment
 * titles legitimately contain brackets of their own.
 */
export function splitSummary(summary: string): { title: string; courseCode: string | null } {
  const match = summary.match(/^(.*)\s*\[([^\]]+)\]\s*$/);
  if (!match) return { title: summary.trim(), courseCode: null };
  const title = match[1].trim();
  // A summary that is *only* a bracketed group is a title, not a course code.
  if (!title) return { title: summary.trim(), courseCode: null };
  return { title, courseCode: match[2].trim() };
}

/** Recovers Canvas ids from an event URL, which is more reliable than the UID format. */
function idsFromUrl(url: string | null): { courseId: string | null; assignmentId: string | null } {
  if (!url) return { courseId: null, assignmentId: null };
  const course = url.match(/\/courses\/(\d+)/);
  const assignment = url.match(/\/assignments\/(\d+)/);
  return { courseId: course?.[1] ?? null, assignmentId: assignment?.[1] ?? null };
}

export function parseIcs(raw: string, fallbackTimeZone = "UTC"): IcsEvent[] {
  const lines = unfoldLines(raw);
  const events: IcsEvent[] = [];

  let current: Record<string, { value: string; params: Record<string, string> }> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (trimmed === "END:VEVENT") {
      if (current) events.push(buildEvent(current, fallbackTimeZone));
      current = null;
      continue;
    }
    if (!current) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;
    // First occurrence wins; repeated properties are rare here and the first
    // is the one Canvas means.
    if (!(parsed.name in current)) {
      current[parsed.name] = { value: parsed.value, params: parsed.params };
    }
  }

  return events;
}

function buildEvent(
  fields: Record<string, { value: string; params: Record<string, string> }>,
  fallbackTimeZone: string
): IcsEvent {
  const summaryRaw = fields.SUMMARY ? unescapeText(fields.SUMMARY.value) : "";
  const { title, courseCode } = splitSummary(summaryRaw);

  const dtstart = fields.DTSTART;
  const { date, isAllDay } = dtstart
    ? parseIcsDate(dtstart.value, dtstart.params, fallbackTimeZone)
    : { date: null, isAllDay: false };

  const url = fields.URL?.value?.trim() || null;
  const { courseId, assignmentId } = idsFromUrl(url);
  const uid = fields.UID?.value?.trim() ?? "";

  return {
    uid,
    title,
    date,
    isAllDay,
    description: fields.DESCRIPTION ? unescapeText(fields.DESCRIPTION.value).trim() || null : null,
    url,
    courseCode,
    canvasCourseId: courseId,
    canvasAssignmentId: assignmentId,
    // Canvas marks assignment events in the UID and links them to an
    // assignment URL; anything else is a plain calendar event.
    isAssignment: assignmentId !== null || /assignment/i.test(uid),
  };
}

/**
 * Validates that a URL looks like a Canvas calendar feed before we store it.
 * The URL embeds a secret, so a typo shouldn't be silently retried forever.
 */
export function normalizeFeedUrl(input: string): string | null {
  const trimmed = input.trim().replace(/^webcal:\/\//i, "https://");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!/\/feeds\/calendars\//.test(parsed.pathname)) return null;
  return parsed.toString();
}
