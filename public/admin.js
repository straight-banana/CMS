import { auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, collection, query,
  orderBy, onSnapshot, addDoc, deleteDoc, doc, getDoc, serverTimestamp, Timestamp, writeBatch } from "./firebase.js";
import { el, errMsg, courseCard, noticeCard, commentItem, empty, taskCard } from "./common.js";

const root = document.getElementById("app");
let unsubs = [];
const stop = () => { unsubs.forEach((u) => u()); unsubs = []; };
let loginError = "";

// Which fields each collection has: [key, label, required, multiline]
const FIELDS = {
  courses: [["course", "Course name", 1], ["code", "Code (e.g. CSE 101)"], ["credit", "Credit (e.g. 3.0)"],
    ["teacher", "Teacher"], ["contact", "Phone / Email"], ["office", "Office hours"], ["classroomCode", "Google Classroom code"]],
  notices: [["title", "Title", 1], ["body", "Details", 0, 1]],
  tasks: [["title", "Title (e.g. Assignment 2)", 1], ["type", "Type", 0, 0, "select"], ["course", "Course"],
    ["start", "Starts / due", 1, 0, "datetime-local"], ["end", "Ends (optional, default +1 hour)", 0, 0, "datetime-local"],
    ["details", "Details", 0, 1]],
};
const TYPES = ["Assignment", "Quiz", "Exam", "Lab", "Class", "Other"];
const NOUN = { courses: "a course", notices: "a notice", tasks: "a task" };
const RENDER = { tasks: taskCard, courses: courseCard, notices: noticeCard, comments: commentItem };

onAuthStateChanged(auth, async (user) => {
  stop();
  if (!user) return renderLogin();
  try {
    const ok = (await getDoc(doc(db, "admins", user.uid))).exists();
    if (!ok) { loginError = "This account is not an admin."; return signOut(auth); }
    renderPanel(user);
  } catch (e) { loginError = errMsg(e); signOut(auth); }
});

function renderLogin() {
  const msg = el("p", { class: "error", role: "alert" }, loginError); loginError = "";
  const email = el("input", { type: "email", placeholder: "Admin email", required: "", autocomplete: "email" });
  const pass = el("input", { type: "password", placeholder: "Password", required: "", autocomplete: "current-password" });
  const btn = el("button", { class: "btn", type: "submit" }, "Log in");
  root.replaceChildren(el("main", { class: "auth" },
    el("h1", {}, "Admin"), el("p", { class: "muted" }, "CR / admin login only."),
    el("div", { class: "card" }, el("form", { onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = ""; btn.disabled = true;
      try { await signInWithEmailAndPassword(auth, email.value, pass.value); }
      catch (err) { msg.textContent = errMsg(err); btn.disabled = false; }
    } }, email, pass, msg, btn)),
    el("a", { class: "link", href: "/" }, "← Student page")));
}

function renderPanel(user) {
  const body = el("div");
  const tabs = el("nav", { class: "tabs" });
  const show = (name) => {
    stop();
    [...tabs.children].forEach((b) => b.classList.toggle("active", b.dataset.t === name));
    body.replaceChildren(name === "comments" ? commentsView() : name === "import" ? importView() : manager(name));
  };
  ["tasks", "courses", "notices", "comments", "import"].forEach((t) =>
    tabs.append(el("button", { class: "tab", "data-t": t, onclick: () => show(t) }, t[0].toUpperCase() + t.slice(1))));

  root.replaceChildren(
    el("header", { class: "top" }, el("strong", {}, "Class Hub · Admin"),
      el("div", { class: "right" }, el("a", { class: "link", href: "/" }, "Student view"),
        el("button", { class: "btn ghost", onclick: () => signOut(auth) }, "Log out"))),
    el("main", {}, tabs, body));
  show("tasks");
}

function listOf(col, dir) {
  const box = el("div", { class: col === "comments" ? "comments" : "grid" });
  unsubs.push(onSnapshot(query(collection(db, col), orderBy(col === "tasks" ? "start" : "createdAt", dir)),
    (s) => box.replaceChildren(...(s.empty ? [empty("Nothing here yet.")] : s.docs.map((d) =>
      RENDER[col](d.data(), el("button", { class: "btn danger", onclick: async () => {
        if (confirm("Delete this permanently?")) try { await deleteDoc(doc(db, col, d.id)); } catch (e) { alert(errMsg(e)); }
      } }, "Delete"))))),
    (e) => box.replaceChildren(empty(errMsg(e)))));
  return box;
}

const commentsView = () => el("div", {}, el("h2", {}, "Student comments"), listOf("comments", "desc"));

function manager(col) {
  const fields = FIELDS[col].map(([k, label, req, multi, kind]) => {
    const input = kind === "select"
      ? el("select", { name: k }, ...TYPES.map((t) => el("option", { value: t }, t)))
      : el(multi ? "textarea" : "input", { name: k, placeholder: label + (req ? " *" : ""),
          ...(kind ? { type: kind } : {}), ...(req ? { required: "" } : {}) });
    const node = kind === "datetime-local"
      ? el("label", { class: "field" }, el("span", { class: "muted small" }, label + (req ? " *" : "")), input)
      : input;
    return { k, kind, input, node };
  });
  const msg = el("p", { class: "error", role: "alert" });
  const form = el("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = "";
    const data = { createdAt: serverTimestamp() };
    for (const f of fields) {
      const v = f.input.value.trim();
      data[f.k] = f.kind === "datetime-local" ? (v ? Timestamp.fromDate(new Date(v)) : null) : v;
    }
    if (data.end && data.end.toMillis() <= data.start.toMillis()) { msg.textContent = "End must be after start."; return; }
    try { await addDoc(collection(db, col), data); form.reset(); } catch (err) { msg.textContent = errMsg(err); }
  } }, el("h3", {}, `Add ${NOUN[col]}`), fields.map((f) => f.node), msg,
    el("button", { class: "btn", type: "submit" }, "Add"));
  return el("div", {}, form, el("h2", {}, `Current ${col}`), listOf(col, col === "notices" ? "desc" : "asc"));
}

// ---------- Import: paste a table from Google Docs / Sheets / CSV ----------
const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIAS = {
  courses: { course: "course", coursename: "course", subject: "course", title: "course", code: "code", coursecode: "code",
    credit: "credit", credits: "credit", teacher: "teacher", instructor: "teacher", faculty: "teacher",
    phoneemail: "contact", contact: "contact", phone: "contact", email: "contact", officehours: "office", office: "office",
    googleclassroomcode: "classroomCode", classroomcode: "classroomCode", classroom: "classroomCode" },
  tasks: { title: "title", task: "title", name: "title", type: "type", course: "course", subject: "course",
    start: "start", starts: "start", due: "start", duedate: "start", date: "start", end: "end", ends: "end",
    details: "details", description: "details", notes: "details" },
  notices: { title: "title", heading: "title", body: "body", details: "body", description: "body", text: "body" },
};
const REQUIRED = { courses: "course", tasks: "title", notices: "title" };

function parseTable(text) {
  const delim = text.includes("\t") ? "\t" : ",";
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"' && cur === "") q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); rows.push(row);
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
}

function toRecords(col, text) {
  const rows = parseTable(text);
  if (rows.length < 2) return { error: "Need a header row plus at least one data row." };
  const map = rows[0].map((h) => ALIAS[col][norm(h)]);
  const req = REQUIRED[col];
  if (!map.includes(req)) return { error: `No "${req}" column found in the first (header) row. Headers seen: ${rows[0].join(", ")}` };
  const recs = [], skipped = [];
  rows.slice(1).forEach((r, i) => {
    const d = {};
    map.forEach((k, j) => { if (k && r[j] !== undefined) d[k] = r[j]; });
    if (!d[req]) return skipped.push(i + 2);
    if (col === "tasks") {
      const s = new Date(d.start);
      if (!d.start || isNaN(s)) return skipped.push(i + 2);
      const e = d.end ? new Date(d.end) : null;
      d.start = Timestamp.fromDate(s);
      d.end = e && !isNaN(e) && e > s ? Timestamp.fromDate(e) : null;
      d.type = TYPES.find((t) => t.toLowerCase() === (d.type || "").toLowerCase()) || "Other";
    }
    recs.push(d);
  });
  return { recs, skipped, ignored: rows[0].filter((h, j) => h && !map[j]) };
}

function importView() {
  const sel = el("select", {}, ...[["courses", "Courses"], ["tasks", "Tasks"], ["notices", "Notices"]]
    .map(([v, l]) => el("option", { value: v }, l)));
  const area = el("textarea", { rows: "9", placeholder: "Paste your table here (first row = column names)…" });
  const out = el("div");

  const preview = () => {
    out.replaceChildren();
    if (!area.value.trim()) return;
    const col = sel.value, r = toRecords(col, area.value);
    if (r.error) return out.append(el("p", { class: "error" }, r.error));
    const btn = el("button", { class: "btn", onclick: async () => {
      btn.disabled = true;
      try {
        const base = Date.now();
        for (let i = 0; i < r.recs.length; i += 400) {            // Firestore batch limit = 500
          const b = writeBatch(db);
          r.recs.slice(i, i + 400).forEach((d, k) => b.set(doc(collection(db, col)),
            { ...d, createdAt: Timestamp.fromMillis(base + i + k) })); // keeps the pasted order
          await b.commit();
        }
        area.value = ""; out.replaceChildren(el("p", { class: "ok" }, `✓ Imported ${r.recs.length} ${col}.`));
      } catch (e) { btn.disabled = false; out.append(el("p", { class: "error" }, errMsg(e))); }
    } }, `Import ${r.recs.length} ${col}`);
    const first = r.recs[0], label = first.course || first.title;
    out.append(
      el("p", {}, `Found ${r.recs.length} row(s). First: "${label}".`),
      r.ignored.length ? el("p", { class: "muted small" }, `Ignored columns: ${r.ignored.join(", ")}`) : null,
      r.skipped.length ? el("p", { class: "error" }, `Skipped row(s) ${r.skipped.join(", ")} (missing ${REQUIRED[col]}${col === "tasks" ? " or a readable date" : ""}).`) : null,
      btn);
  };
  area.addEventListener("input", preview); sel.addEventListener("change", preview);

  return el("div", {}, el("h2", {}, "Import from Google Docs / Sheets"),
    el("div", { class: "card" },
      el("p", { class: "muted small" }, "In your Google Doc: select the whole table → Copy → paste below. Google Sheets or CSV text works too. Imported rows are ADDED to what you already have."),
      sel, area, out));
}
