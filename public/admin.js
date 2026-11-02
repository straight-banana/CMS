import { auth, db, signInWithEmailAndPassword, signOut, onAuthStateChanged, collection, query,
  orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, serverTimestamp, Timestamp, writeBatch } from "./firebase.js";
import { googleButton, divider, forgotLink } from "./auth-ui.js";
import { el, errMsg, classroomTable, noticeCard, commentItem, taskCard, empty, tabs, isClassTest, COLS, loading, failed, labeled } from "./common.js";
import { TYPES, STATUSES, REQUIRED, canon, normalizeRecord, parseWhen } from "./data-format.js";
import { jsonImportView, toDoc } from "./json-import.js";

const root = document.getElementById("app");
let unsubs = [];
const stop = () => { unsubs.forEach((u) => u()); unsubs = []; };
let loginError = "";

// Form fields per collection: [key, label, required, multiline, input kind]
const FIELDS = {
  courses: COLS.map(([k, l]) => [k, l, k === "course"]),
  notices: [["title", "Title", 1], ["body", "Details", 0, 1]],
  tasks: [["title", "Title", 1], ["type", "Type", 0, 0, "select"], ["course", "Course"],
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
  const email = el("input", { type: "email", placeholder: "name@example.com", required: "", autocomplete: "email" });
  const pass = el("input", { type: "password", required: "", autocomplete: "current-password" });
  const btn = el("button", { class: "btn", type: "submit" }, "Log in");
  root.replaceChildren(el("main", { class: "auth" },
    el("div", { class: "auth-intro" }, el("h1", {}, "Class Hub admin"),
      el("p", { class: "lead" }, "Only the CR and admins can log in here."),
      el("p", {}, el("a", { class: "link", href: "/" }, "Go to the student page"))),
    el("div", { class: "card" }, googleButton(msg), divider(), el("form", { onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = ""; btn.disabled = true;
      try { await signInWithEmailAndPassword(auth, email.value, pass.value); }
      catch (err) { msg.textContent = errMsg(err); btn.disabled = false; }
    } }, labeled("Admin email", email), labeled("Password", pass), forgotLink(email, msg, note), note, msg, btn))));
}

// Class tests and other tasks live in one Firestore collection ("tasks"); the type decides which tab shows them.
const OTHER_TYPES = TYPES.filter((t) => t !== "Class Test");
const TABS = {
  classroom: () => manager("courses", "Classroom"),
  classtests: () => manager("tasks", "Class Tests", { only: isClassTest, types: ["Class Test"], allDay: true, noun: "a class test" }),
  tasks: () => manager("tasks", "Tasks", { only: (t) => !isClassTest(t), types: OTHER_TYPES }),
  notices: () => manager("notices", "Notices"),
};

function renderPanel() {
  const { bar, body } = tabs(
    [["classroom", "Classroom"], ["classtests", "Class Tests"], ["tasks", "Tasks"], ["notices", "Notices"], ["comments", "Comments"], ["import", "Import"]],
    (id, b) => {
      stop();
      b.replaceChildren(id === "comments" ? section("Comments", listOf("comments", "desc"))
        : id === "import" ? importView() : TABS[id]());
    });
  root.replaceChildren(
    el("header", { class: "masthead" }, el("div", { class: "wrap" },
      el("div", {}, el("h1", {}, "Class Hub"), el("p", { class: "byline" }, "Admin control panel")),
      el("div", { class: "mast-actions" }, el("a", { class: "link", href: "/" }, "Student view"),
        el("button", { class: "btn ghost", onclick: () => signOut(auth) }, "Log out")))),
    el("main", { class: "wrap shell" }, el("div", { class: "layout" }, bar, body)),
    el("footer", { class: "wrap foot" }, "Changes save to the live site straight away. Deleting cannot be undone."));
}

const section = (title, ...kids) => el("div", {}, el("h2", {}, title), ...kids);

const p2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const ymdhm = (d) => `${ymd(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

// The form for one collection. Used to add a new item and, for tasks, to edit an existing one.
// collect() returns { data } or { error }. fill(item) puts an existing item into the fields.
function buildForm(col, { labeled = false, types = TYPES, allDay: allDayDefault = false } = {}) {
  const fields = FIELDS[col].map(([k, label, req, multi, kind]) => {
    const input = kind === "select"
      ? el("select", { name: k }, ...types.map((t) => el("option", { value: t }, t)))
      : el(multi ? "textarea" : "input", { name: k, ...(col === "tasks" && k === "title" ? { placeholder: "For example, Assignment 2" } : {}),
          ...(kind ? { type: kind } : {}), ...(req ? { required: "" } : {}) });
    const node = el("label", { class: "field" }, el("span", {}, label + (req ? " (required)" : "")), input);
    return { k, kind, input, node };
  });
  const field = (k) => fields.find((f) => f.k === k);
  const nodes = fields.map((f) => f.node);

  // Tasks only: "All day" turns the start into a plain date (class tests have a date but no time),
  // and Status lets the CR set upcoming / due soon / rescheduled / done by hand.
  let allDay = null, status = null, syncAllDay = () => {};
  if (col === "tasks") {
    allDay = el("input", { type: "checkbox", name: "allDay", ...(allDayDefault ? { checked: "" } : {}) });
    syncAllDay = () => {
      const on = allDay.checked, s = field("start"), e = field("end"), v = s.input.value;
      s.input.type = on ? "date" : "datetime-local";                       // the browser clears the value when the type changes,
      if (v) s.input.value = on ? v.slice(0, 10) : v.length === 10 ? v + "T09:00" : v;   // so put it back
      if (on) e.input.value = "";
      e.node.style.display = on ? "none" : "";
    };
    allDay.addEventListener("change", syncAllDay);
    status = el("select", { name: "status" }, ...STATUSES.map(([v, l]) => el("option", { value: v }, l)));
    nodes.splice(nodes.indexOf(field("end").node) + 1, 0,
      el("label", { class: "check" }, allDay, el("span", {}, "All day, no specific time (good for class tests)")),
      el("label", { class: "field" }, el("span", { class: "muted small" }, "Status. Auto follows the clock; the others stay until you change them."), status));
  }

  if (allDayDefault && col === "tasks") syncAllDay();          // class tests start in all-day mode

  const collect = () => {
    const data = {};
    for (const f of fields) if (f.kind !== "datetime-local") data[f.k] = f.input.value.trim();
    if (col === "tasks") {
      const on = allDay.checked, s = parseWhen(field("start").input.value), en = on ? null : parseWhen(field("end").input.value);
      if (!s) return { error: "Pick a valid date." };
      if (en && en.date <= s.date) return { error: "The end time must be after the start time." };
      data.start = Timestamp.fromDate(s.date); data.end = en ? Timestamp.fromDate(en.date) : null;
      data.allDay = on; data.status = status.value;
    }
    return { data };
  };

  const fill = (item) => {
    for (const f of fields) if (f.kind !== "datetime-local") f.input.value = item[f.k] || "";
    if (col !== "tasks") return;
    allDay.checked = !!item.allDay; syncAllDay();
    const s = item.start?.toDate?.(), e = item.end?.toDate?.();
    field("start").input.value = s ? (item.allDay ? ymd(s) : ymdhm(s)) : "";
    field("end").input.value = e && !item.allDay ? ymdhm(e) : "";
    status.value = item.status || "";
  };
  const reset = () => { fields.forEach((f) => { f.input.value = f.input.tagName === "SELECT" ? f.input.options[0].value : ""; });
    if (col === "tasks") { allDay.checked = allDayDefault; status.value = ""; syncAllDay(); } };
  return { nodes, collect, fill, reset };
}

function listOf(col, dir, { only = () => true, types } = {}) {
  const out = el("div", {}, loading("Loading…"));
  let items = [], editing = null;                       // editing: id of the task whose form is open
  const del = async (id) => {
    if (!confirm("Delete this permanently?")) return;
    try { await deleteDoc(doc(db, col, id)); } catch (e) { alert(errMsg(e)); }
  };

  // Tasks get a status picker and an Edit button next to Delete.
  const taskActions = (i) => [
    el("select", { class: "status-select", "aria-label": `Status of ${i.title}`, onchange: async (e) => {
      try { await updateDoc(doc(db, "tasks", i.id), { status: e.target.value }); } catch (err) { alert(errMsg(err)); }
    } }, ...STATUSES.map(([v, l]) => el("option", { value: v, ...((i.status || "") === v ? { selected: "" } : {}) }, l))),
    el("button", { class: "btn ghost", onclick: () => { editing = i.id; draw(); } }, "Edit"),
    el("button", { class: "btn danger", onclick: () => del(i.id) }, "Delete"),
  ];

  const editCard = (i) => {
    const f = buildForm("tasks", { labeled: true, types });
    f.fill(i);
    const msg = el("p", { class: "error", role: "alert" });
    return el("article", { class: "card" }, el("h3", {}, "Edit task"),
      el("form", { class: "formgrid", onsubmit: async (e) => {
        e.preventDefault(); msg.textContent = "";
        const r = f.collect();
        if (r.error) { msg.textContent = r.error; return; }
        try { await updateDoc(doc(db, "tasks", i.id), r.data); editing = null; draw(); } catch (err) { msg.textContent = errMsg(err); }
      } }, f.nodes, msg,
      el("div", { class: "actions" }, el("button", { class: "btn", type: "submit" }, "Save"),
        el("button", { class: "btn ghost", type: "button", onclick: () => { editing = null; draw(); } }, "Cancel"))));
  };

  const draw = () => out.replaceChildren(!items.length ? empty("Nothing here yet.", col === "comments" ? "Student comments will appear here." : "Use the form above to add the first one.")
    : col === "courses" ? classroomTable(items, (c) => del(c.id))
    : el("div", { class: "list" }, ...items.map((i) =>
        col === "tasks" ? (editing === i.id ? editCard(i) : taskCard(i, taskActions(i)))
        : RENDER[col](i, el("button", { class: "btn danger", onclick: () => del(i.id) }, "Delete")))));

  unsubs.push(onSnapshot(query(collection(db, col), orderBy(col === "tasks" ? "start" : "createdAt", dir)),
    (s) => { items = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter(only); draw(); },
    (e) => out.replaceChildren(failed(e))));
  return out;
}

function manager(col, title, { only, types, allDay, noun } = {}) {
  const f = buildForm(col, { types, allDay });
  const msg = el("p", { class: "error", role: "alert" });
  const form = el("form", { class: "formgrid", onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = "";
    const r = f.collect();
    if (r.error) { msg.textContent = r.error; return; }
    try { await addDoc(collection(db, col), { ...r.data, createdAt: serverTimestamp() }); f.reset(); }
    catch (err) { msg.textContent = errMsg(err); }
  } }, f.nodes, msg, el("button", { class: "btn", type: "submit" }, "Add " + (noun || NOUN[col]).replace(/^an? /, "")));
  const add = el("details", { class: "card add", open: "" }, el("summary", {}, `Add ${noun || NOUN[col]}`), form);
  return section(title, add, listOf(col, col === "notices" ? "desc" : "asc", { only, types }));
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
    labeled("Table type", sel), labeled("Pasted table", area), out);
}
