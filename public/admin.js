import { auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, collection, query,
  orderBy, onSnapshot, addDoc, deleteDoc, doc, getDoc, serverTimestamp, Timestamp, writeBatch } from "./firebase.js";
import { googleButton, divider, forgotLink } from "./auth-ui.js";
import { el, errMsg, classroomTable, noticeCard, commentItem, taskCard, empty, tabs, COLS } from "./common.js";

const root = document.getElementById("app");
let unsubs = [];
const stop = () => { unsubs.forEach((u) => u()); unsubs = []; };
let loginError = "";

const TYPES = ["Assignment", "Quiz", "Exam", "Lab", "Class", "Other"];
// Form fields per collection: [key, label, required, multiline, input kind]
const FIELDS = {
  courses: COLS.map(([k, l]) => [k, l, k === "course"]),
  notices: [["title", "Title", 1], ["body", "Details", 0, 1]],
  tasks: [["title", "Title, for example Assignment 2", 1], ["type", "Type", 0, 0, "select"], ["course", "Course"],
    ["start", "Starts or is due", 1, 0, "datetime-local"], ["end", "Ends (optional, default is 1 hour)", 0, 0, "datetime-local"],
    ["details", "Details", 0, 1]],
};
const NOUN = { courses: "a course", notices: "a notice", tasks: "a task" };
const RENDER = { tasks: taskCard, notices: noticeCard, comments: commentItem };

// Only users with a document at admins/<uid> get in. That document is created by hand in the Firebase console.
onAuthStateChanged(auth, async (user) => {
  stop();
  if (!user) return renderLogin();
  try {
    const ok = (await getDoc(doc(db, "admins", user.uid))).exists();
    if (!ok) { loginError = "This account is not an admin."; return signOut(auth); }
    renderPanel();
  } catch (e) { loginError = errMsg(e); signOut(auth); }
});

function renderLogin() {
  const msg = el("p", { class: "error", role: "alert" }, loginError); loginError = "";
  const note = el("p", { class: "ok small", role: "status" });
  const email = el("input", { type: "email", placeholder: "Admin email", required: "", autocomplete: "email" });
  const pass = el("input", { type: "password", placeholder: "Password", required: "", autocomplete: "current-password" });
  const btn = el("button", { class: "btn", type: "submit" }, "Log in");
  root.replaceChildren(el("main", { class: "auth" },
    el("h1", {}, "Class Hub admin"), el("p", { class: "muted" }, "Only the CR and admins can log in here."),
    el("div", { class: "card" }, googleButton(msg), divider(), el("form", { onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = ""; btn.disabled = true;
      try { await signInWithEmailAndPassword(auth, email.value, pass.value); }
      catch (err) { msg.textContent = errMsg(err); btn.disabled = false; }
    } }, email, pass, forgotLink(email, msg, note), note, msg, btn)),
    el("p", {}, el("a", { class: "link", href: "/" }, "Go to the student page"))));
}

const TAB_COL = { classroom: "courses", tasks: "tasks", notices: "notices" };

function renderPanel() {
  const { bar, body } = tabs(
    [["classroom", "Classroom"], ["tasks", "Tasks"], ["notices", "Notices"], ["comments", "Comments"], ["import", "Import"]],
    (id, b) => {
      stop();
      b.replaceChildren(id === "comments" ? section("Comments", listOf("comments", "desc"))
        : id === "import" ? importView() : manager(TAB_COL[id], id[0].toUpperCase() + id.slice(1)));
    });
  root.replaceChildren(
    el("header", { class: "top" }, el("span", { class: "muted small" }, "Admin"),
      el("div", { class: "right" }, el("a", { class: "link", href: "/" }, "Student view"),
        el("button", { class: "btn ghost", onclick: () => signOut(auth) }, "Log out"))),
    el("main", {}, el("h1", {}, "Class Hub"), el("p", { class: "byline" }, "Admin control panel"), bar, body));
}

const section = (title, ...kids) => el("div", {}, el("h2", {}, title), ...kids);

function listOf(col, dir) {
  const out = el("div");
  const del = async (id) => {
    if (!confirm("Delete this permanently?")) return;
    try { await deleteDoc(doc(db, col, id)); } catch (e) { alert(errMsg(e)); }
  };
  unsubs.push(onSnapshot(query(collection(db, col), orderBy(col === "tasks" ? "start" : "createdAt", dir)),
    (s) => {
      const items = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      out.replaceChildren(!items.length ? empty("Nothing here yet.")
        : col === "courses" ? classroomTable(items, (c) => del(c.id))
        : el("div", { class: col === "comments" ? "stack" : "grid" }, ...items.map((i) =>
            RENDER[col](i, el("button", { class: "btn danger", onclick: () => del(i.id) }, "Delete")))));
    },
    (e) => out.replaceChildren(empty(errMsg(e)))));
  return out;
}

function manager(col, title) {
  const fields = FIELDS[col].map(([k, label, req, multi, kind]) => {
    const input = kind === "select"
      ? el("select", { name: k }, ...TYPES.map((t) => el("option", { value: t }, t)))
      : el(multi ? "textarea" : "input", { name: k, placeholder: label + (req ? " (required)" : ""),
          ...(kind ? { type: kind } : {}), ...(req ? { required: "" } : {}) });
    const node = kind === "datetime-local"
      ? el("label", { class: "field" }, el("span", { class: "muted small" }, label + (req ? " (required)" : "")), input)
      : input;
    return { k, kind, input, node };
  });
  const msg = el("p", { class: "error", role: "alert" });
  const form = el("form", { onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = "";
    const data = { createdAt: serverTimestamp() };
    for (const f of fields) {
      const v = f.input.value.trim();
      data[f.k] = f.kind === "datetime-local" ? (v ? Timestamp.fromDate(new Date(v)) : null) : v;
    }
    if (data.end && data.end.toMillis() <= data.start.toMillis()) { msg.textContent = "The end time must be after the start time."; return; }
    try { await addDoc(collection(db, col), data); form.reset(); } catch (err) { msg.textContent = errMsg(err); }
  } }, fields.map((f) => f.node), msg, el("button", { class: "btn", type: "submit" }, "Add"));
  const add = el("details", { class: "card add", open: "" }, el("summary", {}, `Add ${NOUN[col]}`), form);
  return section(title, add, listOf(col, col === "notices" ? "desc" : "asc"));
}

// ---------- Import: paste a table from Google Docs, Google Sheets or CSV ----------
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
  const sel = el("select", {}, ...[["courses", "Classroom"], ["tasks", "Tasks"], ["notices", "Notices"]]
    .map(([v, l]) => el("option", { value: v }, l)));
  const area = el("textarea", { rows: "9", placeholder: "Paste the table here. The first row holds the column names." });
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
        for (let i = 0; i < r.recs.length; i += 400) {            // a Firestore batch holds 500 writes at most
          const b = writeBatch(db);
          r.recs.slice(i, i + 400).forEach((d, k) => b.set(doc(collection(db, col)),
            { ...d, createdAt: Timestamp.fromMillis(base + i + k) })); // keeps the pasted order
          await b.commit();
        }
        area.value = ""; out.replaceChildren(el("p", { class: "ok" }, `Imported ${r.recs.length} rows.`));
      } catch (e) { btn.disabled = false; out.append(el("p", { class: "error" }, errMsg(e))); }
    } }, `Import ${r.recs.length} rows`);
    const first = r.recs[0], label = first.course || first.title;
    out.append(
      el("p", {}, `Found ${r.recs.length} rows. The first one is "${label}".`),
      r.ignored.length ? el("p", { class: "muted small" }, `Ignored columns: ${r.ignored.join(", ")}`) : null,
      r.skipped.length ? el("p", { class: "error" }, `Skipped rows ${r.skipped.join(", ")}. They have no ${REQUIRED[col]}${col === "tasks" ? " or no readable date" : ""}.`) : null,
      btn);
  };
  area.addEventListener("input", preview); sel.addEventListener("change", preview);

  return section("Import",
    el("div", { class: "card" },
      el("p", { class: "muted" }, "Select the table in your Google Doc, copy it, and paste it below. Google Sheets and CSV text also work. Imported rows are added to the existing ones."),
      sel, area, out));
}
