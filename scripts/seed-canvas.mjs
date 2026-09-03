#!/usr/bin/env node
/**
 * Fills a Canvas course with realistic test coursework, so the app has
 * something to sync during development.
 *
 * A brand-new free Canvas account is empty, and building a decent test corpus
 * by hand through the Canvas UI takes ages. This creates weighted assignment
 * groups, a spread of assignments (overdue, due today, later, one undated),
 * and a syllabus containing dates that exist nowhere else — which is exactly
 * what the syllabus scanner is supposed to find.
 *
 * Usage:
 *   CANVAS_DOMAIN=canvas.instructure.com CANVAS_TOKEN=xxxx node scripts/seed-canvas.mjs
 *
 * Get a token at: <your canvas>/profile/settings -> New Access Token.
 * You need a course you teach; create one in the Canvas UI first if you have none.
 */

const domain = (process.env.CANVAS_DOMAIN || "canvas.instructure.com")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");
const token = process.env.CANVAS_TOKEN;

if (!token) {
  console.error("Missing CANVAS_TOKEN.\n");
  console.error("  CANVAS_DOMAIN=canvas.instructure.com CANVAS_TOKEN=xxxx node scripts/seed-canvas.mjs");
  process.exit(1);
}

const base = `https://${domain}/api/v1`;

async function canvas(path, options = {}) {
  const res = await fetch(base + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${res.status} ${res.statusText}\n${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Days from now, at a fixed local-ish hour, as a Canvas-friendly ISO string. */
function dueIn(days, hour = 23, minute = 59) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function dateLabel(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Deliberately spans every bucket the timeline renders and every branch of the
// priority scorer: overdue, imminent-but-trivial, distant-but-heavy, undated.
const GROUPS = [
  { name: "Exams", weight: 50 },
  { name: "Homework", weight: 30 },
  { name: "Participation", weight: 20 },
];

const ASSIGNMENTS = [
  { group: "Homework", name: "Problem Set 6", points: 20, due: dueIn(-3) },
  { group: "Participation", name: "Week 8 Discussion Post", points: 10, due: dueIn(0, 21, 0) },
  { group: "Homework", name: "Problem Set 7", points: 25, due: dueIn(1) },
  { group: "Exams", name: "Midterm Exam 2", points: 200, due: dueIn(2, 10, 30) },
  { group: "Homework", name: "Lab Report 4", points: 40, due: dueIn(5) },
  { group: "Participation", name: "Peer Review", points: 5, due: dueIn(6) },
  { group: "Homework", name: "Problem Set 8", points: 25, due: dueIn(9) },
  { group: "Exams", name: "Research Paper", points: 150, due: dueIn(12, 23, 59) },
  { group: "Homework", name: "Problem Set 9", points: 25, due: dueIn(16) },
  { group: "Exams", name: "Final Exam", points: 300, due: dueIn(28, 12, 0) },
  { group: "Participation", name: "Reading Journal (ongoing)", points: 30, due: null },
];

// Dates here intentionally exist ONLY in the syllabus, never as assignments —
// that gap is the whole reason syllabus scanning exists.
const SYLLABUS = `
<h2>Course Syllabus</h2>
<p>Office hours: Tuesdays 2-4pm, Science Hall 214.</p>

<h3>Grading</h3>
<table>
  <tr><td>Exams</td><td>50%</td></tr>
  <tr><td>Homework</td><td>30%</td></tr>
  <tr><td>Participation</td><td>20%</td></tr>
</table>

<h3>Important Dates</h3>
<table>
  <tr><td>${dateLabel(4)}</td><td>Guest lecture &mdash; attendance required</td></tr>
  <tr><td>${dateLabel(8)}</td><td>Research paper proposal due in class (hard copy)</td></tr>
  <tr><td>${dateLabel(14)}</td><td>Last day to withdraw with a W</td></tr>
  <tr><td>${dateLabel(21)}</td><td>Group presentations begin</td></tr>
</table>

<h3>Policies</h3>
<p><strong>Late work:</strong> 10% deducted per day late, no credit accepted after 3 days.</p>
<p><strong>Attendance:</strong> More than 3 unexcused absences lowers your final grade by one letter.</p>
<p><strong>Exam format:</strong> Midterms are closed-book; the final is cumulative and allows one handwritten note sheet.</p>
`.trim();

async function main() {
  const me = await canvas("/users/self");
  console.log(`Connected to ${domain} as ${me.name}\n`);

  const courses = await canvas("/courses?enrollment_type=teacher&per_page=100");
  if (!courses.length) {
    console.error("No courses found where you're the teacher.\n");
    console.error(`Create one first: https://${domain} -> Dashboard -> "Start a new course".`);
    console.error("Then re-run this script.");
    process.exit(1);
  }

  const course = courses[0];
  console.log(`Seeding course: ${course.name} (id ${course.id})`);
  if (courses.length > 1) {
    console.log(`(${courses.length} courses found; using the first. Others: ${courses.slice(1).map((c) => c.name).join(", ")})`);
  }
  console.log("");

  // Group weights only affect grades — and our importance scoring — when the
  // course is told to apply them.
  await canvas(`/courses/${course.id}`, {
    method: "PUT",
    body: JSON.stringify({
      course: { apply_assignment_group_weights: true, syllabus_body: SYLLABUS },
    }),
  });
  console.log("Set syllabus body and enabled weighted assignment groups");

  const existingGroups = await canvas(`/courses/${course.id}/assignment_groups?per_page=100`);
  const groupIds = {};

  for (const g of GROUPS) {
    const existing = existingGroups.find((e) => e.name === g.name);
    if (existing) {
      await canvas(`/courses/${course.id}/assignment_groups/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: g.name, group_weight: g.weight }),
      });
      groupIds[g.name] = existing.id;
      console.log(`Updated group: ${g.name} (${g.weight}%)`);
    } else {
      const created = await canvas(`/courses/${course.id}/assignment_groups`, {
        method: "POST",
        body: JSON.stringify({ name: g.name, group_weight: g.weight }),
      });
      groupIds[g.name] = created.id;
      console.log(`Created group: ${g.name} (${g.weight}%)`);
    }
  }
  console.log("");

  const existing = await canvas(`/courses/${course.id}/assignments?per_page=100`);
  const existingNames = new Set(existing.map((a) => a.name));

  let created = 0;
  let skipped = 0;
  for (const a of ASSIGNMENTS) {
    if (existingNames.has(a.name)) {
      skipped++;
      continue;
    }
    await canvas(`/courses/${course.id}/assignments`, {
      method: "POST",
      body: JSON.stringify({
        assignment: {
          name: a.name,
          points_possible: a.points,
          due_at: a.due,
          assignment_group_id: groupIds[a.group],
          published: true,
          submission_types: ["online_text_entry"],
        },
      }),
    });
    created++;
    const when = a.due ? new Date(a.due).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "no due date";
    console.log(`  + ${a.name} (${a.points} pts, ${when})`);
  }

  console.log(`\nDone. Created ${created} assignments${skipped ? `, skipped ${skipped} that already existed` : ""}.`);
  console.log(`\nNow in Canvity: Settings -> connect "${domain}" with your token -> Update & sync.`);
  console.log("Then check the Timeline, and try Syllabus -> Scan syllabus on this course.");
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
