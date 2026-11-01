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
export const dateOnly = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const ERRORS = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/email-already-in-use": "This email is already registered. Log in instead.",
  "auth/weak-password": "The password needs at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Try again later.",
  "auth/network-request-failed": "No connection. Check your network and try again.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/unauthorized-domain": "This site's domain is not in the Firebase authorized domains list yet.",
  "auth/operation-not-allowed": "This sign-in method is not turned on in Firebase yet.",
  "auth/missing-email": "Enter your email address.",
  "permission-denied": "You do not have permission to do that.",
};
export const errMsg = (e) => ERRORS[e.code] || e.message || "Something went wrong.";
export const empty = (t) => el("p", { class: "empty" }, t);

// Columns match the Google Doc table, in the same order, with the same labels.
export const COLS = [
  ["course", "Course"], ["code", "Code"], ["credit", "Credit"], ["teacher", "Teacher"],
  ["contact", "Phone / Email"], ["office", "Office hours"], ["classroomCode", "Google Classroom code"],
];

export const classroomTable = (items, onDelete) =>
  el("div", { class: "table-wrap" }, el("table", { class: "doc" },
    el("thead", {}, el("tr", {},
      ...COLS.map(([, label]) => el("th", { scope: "col" }, label)),
      onDelete ? el("th", { scope: "col" }, "Action") : null)),
    el("tbody", {}, ...items.map((c) => el("tr", {},
      ...COLS.map(([k, label]) => el("td", { "data-label": label }, c[k] || null)),
      onDelete ? el("td", { "data-label": "Action" },
        el("button", { class: "btn danger", onclick: () => onDelete(c) }, "Delete")) : null)))));

export const noticeCard = (n, actions) =>
  el("article", { class: "card" },
    el("h3", {}, n.title), el("p", { class: "text" }, n.body || null),
    el("p", { class: "muted small" }, fmt(n.createdAt)), actions);

export const commentItem = (c, actions) =>
  el("div", { class: "comment" },
    el("div", { class: "row" }, el("strong", {}, c.name || "Student"), el("span", { class: "muted small" }, fmt(c.createdAt))),
    el("p", { class: "text" }, c.text), actions);

// ---------- Tasks: status from the clock, Google Calendar link, .ics ----------
const pad = (n) => String(n).padStart(2, "0");
const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const span = (t) => {
  const s = t.start.toDate();
  const e = t.end?.toDate ? t.end.toDate() : new Date(s.getTime() + 3600000); // no end time: 1 hour
  return [s, e];
};

// A task is upcoming, then due soon (under 24 hours before the start), then happening now,
// then done once the end time passes. The page re-checks the clock every 30 seconds.
export const taskStatus = (t) => {
  const [s, e] = span(t), now = Date.now();
  if (now >= e) return "done";
  if (now >= s) return "now";
  return s - now < 864e5 ? "soon" : "upcoming";
};
const LABEL = { done: "Done", now: "Happening now", soon: "Due soon", upcoming: "Upcoming" };

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
    ? `${s.toLocaleString([], o)} to ${e.toLocaleTimeString([], { timeStyle: "short" })}`
    : `${s.toLocaleString([], o)} to ${e.toLocaleString([], o)}`;
};

export const taskCard = (t, actions) => {
  const st = taskStatus(t);
  return el("article", { class: `card task ${st}` },
    el("div", { class: "row" }, el("h3", {}, t.title), el("span", { class: `badge ${st}` }, LABEL[st])),
    el("p", { class: "muted small" }, [t.type, t.course].filter(Boolean).join(" · ")),
    el("p", {}, when(t)),
    t.details ? el("p", { class: "text" }, t.details) : null,
    el("div", { class: "actions" },
      st !== "done" ? el("a", { class: "btn ghost", href: gcalUrl(t), target: "_blank", rel: "noopener" }, "Add to Google Calendar") : null,
      st !== "done" ? el("button", { class: "btn ghost", onclick: () => downloadIcs(t) }, "Download .ics") : null,
      actions));
};

// ---------- Tabs, one per section of the doc. The tab name is kept in the URL hash. ----------
export function tabs(defs, render) {
  const bar = el("nav", { class: "tabs", role: "tablist" });
  const body = el("div", { class: "panel" });
  const select = (id, push = true) => {
    if (!defs.some((d) => d[0] === id)) id = defs[0][0];
    [...bar.children].forEach((b) => {
      const on = b.dataset.t === id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    if (push) history.replaceState(null, "", "#" + id);
    render(id, body);
  };
  defs.forEach(([id, label]) =>
    bar.append(el("button", { class: "tab", role: "tab", "data-t": id, onclick: () => select(id) }, label)));
  select(location.hash.slice(1), false);
  return { bar, body };
}
