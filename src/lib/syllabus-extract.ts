import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const SYLLABUS_KINDS = [
  "exam",
  "quiz",
  "project",
  "assignment",
  "deadline",
  "reading",
  "policy",
  "resource",
  "other",
] as const;

// kind/importance are plain strings rather than z.enum on purpose: the enum
// constraint is passed to the model as guidance, not enforced by the API, so an
// off-list value would fail Zod validation and silently discard the whole
// extraction. They are normalized to the known sets below instead.
const ExtractedItemSchema = z.object({
  kind: z.string().describe(`One of: ${SYLLABUS_KINDS.join(", ")}`),
  title: z.string().describe("Short label, e.g. 'Midterm Exam 2' or 'Late work policy'"),
  detail: z
    .string()
    .nullable()
    .describe("One or two sentences of useful specifics. Null if the title says it all."),
  date: z
    .string()
    .nullable()
    .describe(
      "ISO 8601: 'YYYY-MM-DD', or 'YYYY-MM-DDTHH:mm' when a time of day is given. Null for undated facts like a grading breakdown."
    ),
  endDate: z
    .string()
    .nullable()
    .describe("Same format as date. Only set when the item spans a range, e.g. an exam window."),
  importance: z
    .string()
    .describe(
      "One of: high, medium, low. high = exams, major projects, hard deadlines. low = minor readings, optional items."
    ),
  sourceQuote: z
    .string()
    .nullable()
    .describe("The exact sentence or table row this came from, so the student can verify it."),
});

const ExtractionSchema = z.object({
  items: z.array(ExtractedItemSchema),
});

export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

export interface ExtractionContext {
  courseName: string;
  /** Anchors bare dates like "Oct 3" to the right year. */
  termStart: Date | null;
  termEnd: Date | null;
  now: Date;
}

export interface SyllabusSource {
  /** Plain text of the syllabus, when it came from the Canvas syllabus page or a text file. */
  text?: string;
  /** Raw PDF bytes, when the syllabus was uploaded as a PDF. */
  pdf?: Buffer;
}

const MAX_TEXT_CHARS = 400_000;

export class SyllabusTooLargeError extends Error {}

function buildSystemPrompt(ctx: ExtractionContext): string {
  const term =
    ctx.termStart && ctx.termEnd
      ? `Known coursework in this course runs from ${iso(ctx.termStart)} to ${iso(ctx.termEnd)}.`
      : "The exact term dates are unknown.";

  return `You extract the things a student would be penalized for missing from a course syllabus.

Course: ${ctx.courseName}
Today's date: ${iso(ctx.now)}
${term}

Extract two categories of item:

1. DATED items — exams, quizzes, projects and their milestones, presentations, hard
   deadlines (drop/withdraw dates, proposal due dates), and scheduled events that
   carry a consequence. These matter most: they frequently exist only in the syllabus
   and never as a Canvas assignment, so they are the ones students actually miss.

2. UNDATED items — policies and facts that change how a student should act: the
   grading breakdown, late-work and makeup policy, attendance rules, required
   materials, exam format, and academic-integrity specifics. Give these a null date.

Resolving dates is the part to get right:
- A syllabus usually writes dates without a year ("Oct 3", "10/3", "Week 6 — Monday").
  Infer the year from the term window above. Never emit a year outside that window
  unless the syllabus states one explicitly.
- Interpret ambiguous numeric dates as US-style month/day, which is what Canvas uses.
- Only include a time of day when the syllabus actually gives one.
- If an item is clearly dated but you cannot pin the date down, still include it with a
  null date and say what you know in 'detail'. Do not invent a date.

Do not include: the instructor's name, generic university boilerplate, week-by-week
reading assignments with no due date or consequence, or anything you are guessing at.
Prefer a shorter, high-signal list over an exhaustive one.`;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Runs the syllabus through Claude and returns structured items. */
export async function extractSyllabusItems(
  source: SyllabusSource,
  ctx: ExtractionContext
): Promise<ExtractedItem[]> {
  if (source.text && source.text.length > MAX_TEXT_CHARS) {
    throw new SyllabusTooLargeError(
      `Syllabus text is ${source.text.length} characters, beyond the ${MAX_TEXT_CHARS} this app will send for extraction.`
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new SyllabusExtractionError(
      "Syllabus scanning needs an Anthropic API key. Set ANTHROPIC_API_KEY in your environment to enable it."
    );
  }

  const client = new Anthropic();

  const content: Anthropic.ContentBlockParam[] = [];
  if (source.pdf) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: source.pdf.toString("base64") },
    });
  }
  content.push({
    type: "text",
    text: source.text
      ? `Here is the syllabus:\n\n${source.text}`
      : "Extract the important items from the attached syllabus.",
  });

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: buildSystemPrompt(ctx),
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new SyllabusExtractionError("The model declined to process this syllabus.");
  }
  // An empty list is a legitimate answer; a null parse is not, and must not be
  // reported to the user as "scanned, found nothing".
  if (!response.parsed_output) {
    throw new SyllabusExtractionError("The syllabus response could not be parsed into the expected shape.");
  }

  return response.parsed_output.items.map(normalizeItem);
}

export class SyllabusExtractionError extends Error {}

const KIND_SET = new Set<string>(SYLLABUS_KINDS);
const IMPORTANCE_SET = new Set(["high", "medium", "low"]);

function normalizeItem(item: ExtractedItem): ExtractedItem {
  const kind = item.kind?.trim().toLowerCase() ?? "";
  const importance = item.importance?.trim().toLowerCase() ?? "";
  return {
    ...item,
    kind: KIND_SET.has(kind) ? kind : "other",
    importance: IMPORTANCE_SET.has(importance) ? importance : "medium",
  };
}

const HTML_ENTITIES = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  bull: "•",
  middot: "·",
} as const;

/**
 * Canvas syllabus bodies are HTML; reduce to text without pulling in a parser.
 * Course schedules are usually tables, so rows become lines and cells become
 * tabs — keeping a date next to the thing it belongs to.
 */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n\n")
      .replace(/<\/t[dh]>/gi, "\t")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(nbsp|amp|lt|gt|quot|apos|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo|bull|middot);/g, (_, name) =>
        HTML_ENTITIES[name as keyof typeof HTML_ENTITIES]
      )
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      // Collapse runs of spaces only — tabs and newlines carry the structure.
      .replace(/[^\S\n\t]+/g, " ")
      .replace(/ *\t */g, "\t")
      .replace(/ *\n */g, "\n")
      .replace(/\t+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
