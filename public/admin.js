import { auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, collection, query,
  orderBy, onSnapshot, addDoc, deleteDoc, doc, getDoc, serverTimestamp, Timestamp, writeBatch } from "./firebase.js";
import { googleButton, divider, forgotLink } from "./auth-ui.js";
import { el, errMsg, classroomTable, noticeCard, commentItem, taskCard, empty, tabs, COLS } from "./common.js";
import { TYPES, REQUIRED, canon, normalizeRecord, parseWhen } from "./data-format.js";
import { jsonImportView, toDoc } from "./json-import.js";

const root = document.getElementById("app");
let unsubs = [];
const stop = () => { unsubs.forEach((u) => u()); unsubs = []; };
let loginError = "";

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
  const field = (k) => fields.find((f) => f.k === k);
  const nodes = fields.map((f) => f.node);

  // Tasks only: "All day" turns the start into a plain date (class tests have a date but no time).
  let allDay = null, syncAllDay = () => {};
  if (col === "tasks") {
    allDay = el("input", { type: "checkbox", name: "allDay" });
    syncAllDay = () => {
      const on = allDay.checked, s = field("start"), e = field("end"), v = s.input.value;
      s.input.type = on ? "date" : "datetime-local";                       // the browser clears the value when the type changes,
      if (v) s.input.value = on ? v.slice(0, 10) : v.length === 10 ? v + "T09:00" : v;   // so put it back
      if (on) e.input.value = "";
      e.node.style.display = on ? "none" : "";
    };
    allDay.addEventListener("change", syncAllDay);
    nodes.splice(nodes.indexOf(field("end").node) + 1, 0,
      el("label", { class: "check" }, allDay, el("span", {}, "All day, no specific time (good for class tests)")));
  }

  const msg = el("p", { class: "error", role: "alert" });
  const form = el("form", { onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = "";
    const data = { createdAt: serverTimestamp() };
    for (const f of fields) if (f.kind !== "datetime-local") data[f.k] = f.input.value.trim();
    if (col === "tasks") {
      const on = allDay.checked, s = parseWhen(field("start").input.value), en = on ? null : parseWhen(field("end").input.value);
      if (!s) { msg.textContent = "Pick a valid date."; return; }
      if (en && en.date <= s.date) { msg.textContent = "The end time must be after the start time."; return; }
      data.start = Timestamp.fromDate(s.date); data.end = en ? Timestamp.fromDate(en.date) : null; data.allDay = on;
    }
    try { await addDoc(collection(db, col), data); form.reset(); syncAllDay(); } catch (err) { msg.textContent = errMsg(err); }
  } }, nodes, msg, el("button", { class: "btn", type: "submit" }, "Add"));
  const add = el("details", { class: "card add", open: "" }, el("summary", {}, `Add ${NOUN[col]}`), form);
  return section(title, add, listOf(col, col === "notices" ? "desc" : "asc"));
}

// ---------- Import: JSON files (many at once) and pasted tables ----------
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

function toRecords(col, text, defaultType) {
  const rows = parseTable(text);
  if (rows.length < 2) return { error: "Need a header row plus at least one data row." };
  const heads = rows[0], map = heads.map((h) => canon(col, h)), req = REQUIRED[col];
  if (!map.includes(req)) return { error: `No "${req}" column found in the first (header) row. Headers seen: ${heads.join(", ")}` };
  const recs = [], skipped = [];
  rows.slice(1).forEach((r, i) => {
    const raw = {};
    heads.forEach((h, j) => { if (map[j] && r[j] !== undefined) raw[h] = r[j]; });
    const n = normalizeRecord(col, raw, { defaultType });
    if (n.rec) recs.push(n.rec); else skipped.push(i + 2);
  });
  return { recs, skipped, ignored: heads.filter((h, j) => h && !map[j]) };
}

const importView = () => section("Import", jsonImportView(), el("h2", {}, "Paste a table"), pasteImport());

function pasteImport() {
  const sel = el("select", {}, ...[["courses", "Classroom"], ["tasks", "Tasks"], ["tasks-ct", "Class tests (CT table)"], ["notices", "Notices"]]
    .map(([v, l]) => el("option", { value: v }, l)));
  const area = el("textarea", { rows: "9", placeholder: "Paste the table here. The first row holds the column names." });
  const out = el("div");

  const preview = () => {
    out.replaceChildren();
    if (!area.value.trim()) return;
    const ct = sel.value === "tasks-ct", col = ct ? "tasks" : sel.value, r = toRecords(col, area.value, ct ? "Class Test" : undefined);
    if (r.error) return out.append(el("p", { class: "error" }, r.error));
    const btn = el("button", { class: "btn", onclick: async () => {
      btn.disabled = true;
      try {
        const base = Date.now();
        for (let i = 0; i < r.recs.length; i += 400) {            // a Firestore batch holds 500 writes at most
          const b = writeBatch(db);
          r.recs.slice(i, i + 400).forEach((d, k) => b.set(doc(collection(db, col)), toDoc(col, d, base + i + k))); // keeps the pasted order
          await b.commit();
        }
        area.value = ""; out.replaceChildren(el("p", { class: "ok" }, `Imported ${r.recs.length} rows.`));
      } catch (e) { btn.disabled = false; out.append(el("p", { class: "error" }, errMsg(e))); }
    } }, `Import ${r.recs.length} rows`);
    if (!r.recs.length) btn.disabled = true;
    const first = r.recs[0], label = first ? first.course || first.title : "";
    out.append(...[                                              // append(null) would print the word "null"
      first ? el("p", {}, `Found ${r.recs.length} rows. The first one is "${label}".`) : null,
      r.ignored.length ? el("p", { class: "muted small" }, `Ignored columns: ${r.ignored.join(", ")}`) : null,
      r.skipped.length ? el("p", { class: "error" }, `Skipped rows ${r.skipped.join(", ")}. They have no ${REQUIRED[col]}${col === "tasks" ? " or no readable date" : ""}.`) : null,
      btn].filter(Boolean));
  };
  area.addEventListener("input", preview); sel.addEventListener("change", preview);

  return el("div", { class: "card" },
    el("p", { class: "muted" }, "Select the table in your Google Doc, copy it, and paste it below. Google Sheets and CSV text also work. Imported rows are added to the existing ones. "
      + "For the Class Tests table choose Class tests: dates without a time become all-day tasks."),
    sel, area, out);
}
