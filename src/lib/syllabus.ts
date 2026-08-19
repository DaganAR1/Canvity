import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { CanvasClient } from "@/lib/canvas";
import { computeSyllabusPriority } from "@/lib/priority";
import {
  extractSyllabusItems,
  htmlToText,
  SyllabusSource,
  SyllabusTooLargeError,
} from "@/lib/syllabus-extract";

export interface SyllabusScanResult {
  status: "scanned" | "unchanged" | "not_found";
  source: string | null;
  itemsFound: number;
  datedItems: number;
}

export class SyllabusNotFoundError extends Error {}

/**
 * Finds this course's syllabus in Canvas, extracts the dates and policies that
 * matter, and stores them. Re-scanning an unchanged syllabus is a no-op so the
 * extraction isn't paid for twice.
 */
export async function scanCourseSyllabus(courseId: string, opts: { force?: boolean } = {}): Promise<SyllabusScanResult> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { canvasAccount: true },
  });
  if (!course) throw new Error("Course not found");

  const token = decryptToken(course.canvasAccount.encryptedToken);
  const client = new CanvasClient(course.canvasAccount.domain, token);
  const canvasCourseId = Number(course.canvasCourseId);

  const found = await locateSyllabus(client, canvasCourseId);
  if (!found) {
    await prisma.course.update({
      where: { id: course.id },
      data: {
        syllabusScannedAt: new Date(),
        syllabusError: "No syllabus page or syllabus file was found in this Canvas course.",
        syllabusSource: null,
      },
    });
    return { status: "not_found", source: null, itemsFound: 0, datedItems: 0 };
  }

  const hash = crypto.createHash("sha256").update(found.fingerprint).digest("hex");
  if (!opts.force && course.syllabusHash === hash) {
    const existing = await prisma.syllabusItem.count({ where: { courseId: course.id } });
    return { status: "unchanged", source: course.syllabusSource, itemsFound: existing, datedItems: 0 };
  }

  // Canvas assignment dates are the most reliable signal for which term this
  // course actually runs in, which is what bare dates need to resolve against.
  const bounds = await prisma.assignment.aggregate({
    where: { courseId: course.id, dueAt: { not: null } },
    _min: { dueAt: true },
    _max: { dueAt: true },
  });

  try {
    const extracted = await extractSyllabusItems(found.source, {
      courseName: course.name,
      termStart: bounds._min.dueAt,
      termEnd: bounds._max.dueAt,
      now: new Date(),
    });

    const rows = extracted.map((item) => {
      const date = parseExtractedDate(item.date);
      const { score, tier } = computeSyllabusPriority({
        date,
        importance: item.importance,
        courseWeight: course.weight,
      });
      return {
        courseId: course.id,
        kind: item.kind,
        title: item.title,
        detail: item.detail,
        date,
        endDate: parseExtractedDate(item.endDate),
        importance: item.importance,
        sourceQuote: item.sourceQuote,
        priorityScore: score,
        priorityTier: tier,
      };
    });

    // Replace wholesale: a re-scan reflects the current syllabus, and stale
    // items from a previous revision should not linger on the timeline.
    await prisma.$transaction([
      prisma.syllabusItem.deleteMany({ where: { courseId: course.id } }),
      prisma.syllabusItem.createMany({ data: rows }),
      prisma.course.update({
        where: { id: course.id },
        data: {
          syllabusHash: hash,
          syllabusSource: found.label,
          syllabusScannedAt: new Date(),
          syllabusError: null,
        },
      }),
    ]);

    return {
      status: "scanned",
      source: found.label,
      itemsFound: rows.length,
      datedItems: rows.filter((r) => r.date !== null).length,
    };
  } catch (err) {
    const message =
      err instanceof SyllabusTooLargeError
        ? err.message
        : err instanceof Error
          ? `Could not read this syllabus: ${err.message}`
          : "Could not read this syllabus.";
    await prisma.course.update({
      where: { id: course.id },
      data: { syllabusScannedAt: new Date(), syllabusError: message },
    });
    throw err;
  }
}

interface LocatedSyllabus {
  source: SyllabusSource;
  label: string;
  /** Stable string identifying this exact content, for change detection. */
  fingerprint: string;
}

/**
 * Prefers an uploaded syllabus file, because instructors who upload one usually
 * leave the Canvas page as a stub pointing at it.
 */
async function locateSyllabus(client: CanvasClient, canvasCourseId: number): Promise<LocatedSyllabus | null> {
  const files = await client.findSyllabusFiles(canvasCourseId);
  if (files.length > 0) {
    const file = files[0];
    const bytes = await client.downloadFile(file);
    if (file["content-type"] === "application/pdf") {
      return {
        source: { pdf: bytes },
        label: file.display_name,
        fingerprint: crypto.createHash("sha256").update(bytes).digest("hex"),
      };
    }
    const text = file["content-type"] === "text/html" ? htmlToText(bytes.toString("utf8")) : bytes.toString("utf8");
    if (text.trim().length >= MIN_USEFUL_LENGTH) {
      return { source: { text }, label: file.display_name, fingerprint: text };
    }
  }

  const body = await client.getSyllabusBody(canvasCourseId);
  if (body) {
    const text = htmlToText(body);
    if (text.length >= MIN_USEFUL_LENGTH) {
      return { source: { text }, label: "Canvas syllabus page", fingerprint: text };
    }
  }

  return null;
}

// Below this, it's a stub like "See the attached PDF" — not worth an extraction call.
const MIN_USEFUL_LENGTH = 200;

/**
 * Extracted dates arrive as "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss]" and are read
 * as UTC. Anything else is treated as a failed extraction rather than guessed at.
 */
export function parseExtractedDate(value: string | null): Date | null {
  if (!value) return null;

  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(:\d{2})?)?/);
  if (!match) return null;

  const [, day, time, seconds] = match;
  const date = new Date(`${day}T${time ?? "00:00"}${seconds ?? ":00"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
