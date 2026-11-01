export const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
};

export const fmt = (ts) =>
  ts?.toDate ? ts.toDate().toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "just now";

const ERRORS = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/invalid-email": "Please enter a valid email.",
  "auth/email-already-in-use": "This email is already registered. Try logging in.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Try again later.",
  "auth/network-request-failed": "Network error. Check your connection.",
  "permission-denied": "You don't have permission to do that.",
};
export const errMsg = (e) => ERRORS[e.code] || e.message || "Something went wrong.";

const info = (label, value) =>
  value ? el("p", { class: "info" }, el("span", { class: "muted" }, label), el("span", {}, value)) : null;

export const courseCard = (c, actions) =>
  el("article", { class: "card" },
    el("div", { class: "row" }, el("h3", {}, c.course), el("span", { class: "pill" }, `${c.credit || "—"} cr`)),
    el("p", { class: "muted code" }, c.code || ""),
    info("Teacher", c.teacher), info("Contact", c.contact),
    info("Office hours", c.office), info("Classroom code", c.classroomCode),
    actions);

export const noticeCard = (n, actions) =>
  el("article", { class: "card" },
    el("h3", {}, n.title), el("p", { class: "body" }, n.body || ""),
    el("p", { class: "muted small" }, fmt(n.createdAt)), actions);

export const commentItem = (c, actions) =>
  el("div", { class: "comment" },
    el("div", { class: "row" }, el("strong", {}, c.name || "Student"), el("span", { class: "muted small" }, fmt(c.createdAt))),
    el("p", { class: "body" }, c.text), actions);

export const empty = (t) => el("p", { class: "muted empty" }, t);

// ---------- Tasks: status, Google Calendar link, .ics ----------
const pad = (n) => String(n).padStart(2, "0");
const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const span = (t) => {
  const s = t.start.toDate();
  const e = t.end?.toDate ? t.end.toDate() : new Date(s.getTime() + 3600000); // default: 1 hour
  return [s, e];
};

// RULE: status is computed from the clock, so it flips automatically as time passes.
// upcoming → soon (< 24h before start) → now (between start and end) → done (after end)
export const taskStatus = (t) => {
  const [s, e] = span(t), now = Date.now();
  if (now >= e) return "done";
  if (now >= s) return "now";
  return s - now < 864e5 ? "soon" : "upcoming";
};
const LABEL = { done: "✓ Done", now: "● Happening now", soon: "Due soon", upcoming: "Upcoming" };

// RULE: one tap adds it to Google Calendar (no login/permissions needed).
export const gcalUrl = (t) => {
  const [s, e] = span(t);
  return "https://calendar.google.com/calendar/render?" + new URLSearchParams({
    action: "TEMPLATE", text: t.title, dates: `${utc(s)}/${utc(e)}`,
    details: [t.course, t.details].filter(Boolean).join("\n"),
  });
};

const downloadIcs = (t) => {
  const [s, e] = span(t);
  const esc = (x) => (x || "").replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Class Hub//EN", "BEGIN:VEVENT",
    `UID:${s.getTime()}-${Math.random().toString(36).slice(2)}@classhub`, `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(s)}`, `DTEND:${utc(e)}`, `SUMMARY:${esc(t.title)}`,
    `DESCRIPTION:${esc([t.course, t.details].filter(Boolean).join("\n"))}`,
    "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  el("a", { href: url, download: "task.ics" }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const when = (t) => {
  const [s, e] = span(t), o = { dateStyle: "medium", timeStyle: "short" };
  return s.toDateString() === e.toDateString()
    ? `${s.toLocaleString([], o)} – ${e.toLocaleTimeString([], { timeStyle: "short" })}`
    : `${s.toLocaleString([], o)} → ${e.toLocaleString([], o)}`;
};

export const taskCard = (t, actions) => {
  const st = taskStatus(t);
  return el("article", { class: `card task ${st}` },
    el("div", { class: "row" }, el("h3", {}, t.title), el("span", { class: `badge ${st}` }, LABEL[st])),
    el("p", { class: "muted small" }, [t.type, t.course].filter(Boolean).join(" · ")),
    el("p", {}, "🕒 " + when(t)),
    t.details ? el("p", { class: "body" }, t.details) : null,
    el("div", { class: "actions" },
      st !== "done" ? el("a", { class: "btn ghost", href: gcalUrl(t), target: "_blank", rel: "noopener" }, "📅 Add to Google Calendar") : null,
      st !== "done" ? el("button", { class: "btn ghost", onclick: () => downloadIcs(t) }, ".ics") : null,
      actions));
};
