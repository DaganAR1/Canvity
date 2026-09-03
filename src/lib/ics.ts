// Parser for the iCalendar feed Canvas exposes at Calendar -> "Calendar Feed".
//
// This is the only route to a student's coursework that needs no access token
// and no administrator involvement — the feed URL is a secret link the student
// copies themselves. Many institutions disable student token generation
// entirely, so for those students this is the only way in.
//
// It carries less than the REST API does: assignment names, due dates, course
// codes and links, but no point values, group weights, or submission status.

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
 * Parses an iCalendar date value. Three shapes appear in practice:
 * `20260904T235900Z` (UTC), `20260904T235900` (floating local time, which we
 * read as UTC since the feed gives us no zone), and `20260904` (a calendar
 * date with no time, flagged as all-day so it is never compared to a clock).
 */
export function parseIcsDate(value: string, params: Record<string, string> = {}): { date: Date | null; isAllDay: boolean } {
  const v = value.trim();

  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return { date: null, isAllDay: true };
    const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return { date: Number.isNaN(date.getTime()) ? null : date, isAllDay: true };
  }

  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return { date: null, isAllDay: false };

  const date = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
  );
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

export function parseIcs(raw: string): IcsEvent[] {
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
      if (current) events.push(buildEvent(current));
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

function buildEvent(fields: Record<string, { value: string; params: Record<string, string> }>): IcsEvent {
  const summaryRaw = fields.SUMMARY ? unescapeText(fields.SUMMARY.value) : "";
  const { title, courseCode } = splitSummary(summaryRaw);

  const dtstart = fields.DTSTART;
  const { date, isAllDay } = dtstart
    ? parseIcsDate(dtstart.value, dtstart.params)
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
