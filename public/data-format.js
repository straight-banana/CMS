// Shared by the paste importer and the JSON importer, so both accept and reject the same things.
// No Firebase imports here: this file only turns loose input into clean records.

export const TYPES = ["Assignment", "Class Test", "Quiz", "Exam", "Lab", "Class", "Other"];

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const norm = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
// For duplicate checks. Unlike norm() it keeps non-Latin letters, so Bengali titles do not all look the same.
const fold = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// Header or JSON key (after norm) -> the field name stored in Firestore.
export const ALIAS = {
  courses: { course: "course", coursename: "course", subject: "course", title: "course", code: "code", coursecode: "code",
    credit: "credit", credits: "credit", teacher: "teacher", instructor: "teacher", faculty: "teacher",
    phoneemail: "contact", contact: "contact", phone: "contact", email: "contact",
    primarycommunication: "communication", communication: "communication",
    officehours: "office", office: "office",
    googleclassroomcode: "classroomCode", classroomcode: "classroomCode", classroom: "classroomCode" },
  tasks: { title: "title", task: "title", name: "title", ctno: "title", type: "type", course: "course", subject: "course",
    start: "start", starts: "start", due: "start", duedate: "start", date: "start", end: "end", ends: "end",
    details: "details", description: "details", notes: "details", syllabus: "details", allday: "allDay" },
  notices: { title: "title", heading: "title", body: "body", details: "body", description: "body", text: "body" },
};
export const REQUIRED = { courses: "course", tasks: "title", notices: "title" };
const STRING_KEYS = {
  courses: ["course", "code", "credit", "teacher", "contact", "communication", "office", "classroomCode"],
  tasks: ["title", "course", "details"],
  notices: ["title", "body"],
};

export const canon = (col, header) => { const n = norm(header); return has(ALIAS[col], n) ? ALIAS[col][n] : undefined; };

const TYPE_ALIAS = { assignment: "Assignment", homework: "Assignment", classtest: "Class Test", ct: "Class Test",
  test: "Class Test", quiz: "Quiz", exam: "Exam", lab: "Lab", class: "Class", other: "Other" };
export const normType = (v) => { const n = norm(v); return has(TYPE_ALIAS, n) ? TYPE_ALIAS[n] : "Other"; };

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// "2026-11-10"          -> that day, all day
// "2026-11-10 14:00"    -> 14:00 local time (also "T14:00")
// "2 Nov 2026"          -> that day, all day (a table copied from a Google Doc)
// "2026-11-10T14:00+06:00" or a number (epoch ms) -> exact moment
export function parseWhen(v) {
  if (typeof v === "number") { const d = new Date(v); return isNaN(d) ? null : { date: d, allDay: false }; }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    const [y, mo, da, h = 0, mi = 0, se = 0] = m.slice(1).map((x) => (x === undefined ? undefined : +x));
    const d = new Date(y, mo - 1, da, h, mi, se);
    if (isNaN(d) || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;   // rejects 2026-02-31
    return { date: d, allDay: m[4] === undefined };
  }
  const d = new Date(s);
  if (isNaN(d)) return null;
  const hasTime = /\d{1,2}:\d{2}/.test(s);
  return { date: hasTime ? d : startOfDay(d), allDay: !hasTime };
}

const boolish = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") { const t = v.trim().toLowerCase(); if (/^(true|yes|1)$/.test(t)) return true; if (/^(false|no|0)$/.test(t)) return false; }
  return undefined;
};
const text = (v) => (v == null ? "" : typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

// One loose row -> a clean record, or a reason it was skipped.
// Returns { rec, ignored } or { skip, ignored }. Dates come back as Date objects (the caller makes Timestamps).
export function normalizeRecord(col, raw, { defaultType } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { skip: "is not an object", ignored: [] };
  const d = {}, ignored = [];
  for (const [key, val] of Object.entries(raw)) {
    const k = canon(col, key);
    if (k) d[k] = val; else ignored.push(key);
  }
  const rec = {};
  for (const k of STRING_KEYS[col]) { const t = text(d[k]); if (t) rec[k] = t; }
  if (!rec[REQUIRED[col]]) return { skip: `has no ${REQUIRED[col]}`, ignored };

  if (col === "tasks") {
    if (d.start == null || d.start === "") return { skip: "has no start date", ignored };
    const s = parseWhen(d.start);
    if (!s) return { skip: `has a start date that cannot be read (${String(d.start).slice(0, 30)})`, ignored };
    const allDay = boolish(d.allDay) ?? s.allDay;
    rec.start = allDay ? startOfDay(s.date) : s.date;
    rec.end = null;
    if (!allDay && d.end) { const e = parseWhen(d.end); if (e && e.date > rec.start) rec.end = e.date; }
    rec.allDay = allDay;
    rec.type = d.type ? normType(d.type) : defaultType || "Other";
  }
  return { rec, ignored };
}

// Same record, same key. Used to skip things that are already on the site.
export const dedupeKey = (col, r) =>
  col === "courses" ? `${fold(r.code)}|${fold(r.course)}`
  : col === "tasks" ? `${fold(r.title)}|${fold(r.course)}|${(r.start?.toMillis ? r.start.toMillis() : r.start?.getTime?.()) ?? ""}`
  : `${fold(r.title)}|${fold(r.body)}`;

// ---------- JSON files ----------
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;
const SECTION = { courses: "courses", course: "courses", classroom: "courses", tasks: "tasks", task: "tasks",
  notices: "notices", notice: "notices" };
const META = new Set(["version", "meta", "source", "schema", "generatedat", "note", "notes", "description", "comment"]);

export function parseJsonText(src) {
  let data;
  try { data = JSON.parse(String(src).replace(/^\uFEFF/, "")); }
  catch (e) { return { error: `This is not valid JSON. ${e.message}` }; }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { error: 'The file must be an object like { "tasks": [ ... ] }, not a bare list.' };

  const out = { unknown: [] };
  for (const c of Object.keys(REQUIRED)) out[c] = { recs: [], skipped: [], ignored: new Set() };
  let found = false;
  for (const [key, val] of Object.entries(data)) {
    const n = norm(key);
    if (!has(SECTION, n)) { if (!META.has(n)) out.unknown.push(key); continue; }
    const col = SECTION[n];
    found = true;
    if (!Array.isArray(val)) { out[col].skipped.push({ where: key, why: "must be a list" }); continue; }
    if (val.length > MAX_ROWS) return { error: `"${key}" has ${val.length} rows. The limit is ${MAX_ROWS} per file.` };
    val.forEach((raw, i) => {
      const r = normalizeRecord(col, raw);
      r.ignored.forEach((k) => out[col].ignored.add(k));
      if (r.rec) out[col].recs.push(r.rec);
      else out[col].skipped.push({ where: `${key} #${i + 1}`, why: r.skip });
    });
  }
  if (!found) return { error: 'No "courses", "tasks" or "notices" list found in this file.' };
  return { parsed: out };
}

// A small file people can download and edit.
export const EXAMPLE = {
  version: 1,
  courses: [{ course: "Machine Learning", code: "CSE-411", credit: "3", teacher: "Teacher name",
    contact: "+880 1XXX-XXXXXX · name@example.com", communication: "WhatsApp message or email",
    office: "Mon: 10:00 - 11:00", classroomCode: "abc123xy" }],
  tasks: [
    { title: "CT-1: Machine Learning", type: "Class Test", course: "CSE-411 Machine Learning", start: "2026-11-09",
      details: "Syllabus: Chapter-2" },
    { title: "Assignment 1", type: "Assignment", course: "CSE-413 Compiler Design", start: "2026-11-12 23:59",
      details: "Submit on Google Classroom" },
    { title: "Lab quiz", type: "Quiz", course: "CSE-412 Machine Learning Sessional", start: "2026-11-15 10:00",
      end: "2026-11-15 11:00" },
  ],
  notices: [{ title: "Short speech on thesis topic", body: "CSE-415, announced by the teacher" }],
};
