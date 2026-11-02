import { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile, collection, query, orderBy, onSnapshot, addDoc,
  serverTimestamp } from "./firebase.js";
import { googleButton, divider, forgotLink } from "./auth-ui.js";
import { el, errMsg, dateOnly, classroomTable, noticeCard, commentItem, taskCard, taskStatus, isClassTest,
  empty, tabs, loading, failed, labeled } from "./common.js";

const root = document.getElementById("app");
let unsubs = [];
const stop = () => { unsubs.forEach((u) => u()); unsubs = []; };

onAuthStateChanged(auth, (user) => (user ? renderHub(user) : renderAuth("login")));

function renderAuth(mode) {
  stop();
  const msg = el("p", { class: "error", role: "alert" });
  const note = el("p", { class: "ok small", role: "status" });
  const name = el("input", { autocomplete: "name", required: "", maxlength: "60" });
  const email = el("input", { type: "email", placeholder: "name@example.com", autocomplete: "email", required: "" });
  const pass = el("input", { type: "password", required: "",
    autocomplete: mode === "login" ? "current-password" : "new-password" });
  const btn = el("button", { class: "btn", type: "submit" }, mode === "login" ? "Log in" : "Create account");

  const form = el("form", { onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = ""; btn.disabled = true;
    try {
      if (mode === "login") await signInWithEmailAndPassword(auth, email.value, pass.value);
      else {
        const { user } = await createUserWithEmailAndPassword(auth, email.value, pass.value);
        await updateProfile(user, { displayName: name.value.trim() });
        renderHub(auth.currentUser);
      }
    } catch (err) { msg.textContent = errMsg(err); btn.disabled = false; }
  } }, mode === "register" ? labeled("Full name", name) : null, labeled("Email", email),
    labeled("Password", pass, "At least 6 characters"), mode === "login" ? forgotLink(email, msg, note) : null, note, msg, btn);

  const seg = el("div", { class: "seg" }, ...[["login", "Log in"], ["register", "Create account"]].map(([m, l]) =>
    el("button", { type: "button", class: "seg-btn" + (m === mode ? " active" : ""), "aria-pressed": String(m === mode), onclick: () => renderAuth(m) }, l)));

  root.replaceChildren(el("main", { class: "auth" },
    el("div", { class: "auth-intro" }, el("h1", {}, "Class Hub"),
      el("p", { class: "lead" }, "Course details, class tests, tasks and notices for the class. The class representative keeps it current.")),
    el("div", { class: "card" }, seg, googleButton(msg), divider(), form),
    el("ul", { class: "auth-list" },
      ...[["Classroom", "Teachers, contacts, office hours and Google Classroom codes."],
        ["Class tests", "Dates and syllabus."],
        ["Tasks", "Assignments, quizzes, labs and exams, with Google Calendar and .ics."],
        ["Notices", "Announcements from the CR."]].map(([k, v]) => el("li", {}, el("b", {}, k), el("span", { class: "muted" }, v))))));
}

function renderHub(user) {
  stop();
  const last = {};
  const byline = el("p", { class: "byline" }, "Maintained by the CR");
  const setByline = () => {
    const t = Math.max(0, ...Object.values(last));
    byline.textContent = "Maintained by the CR" + (t ? " · Last updated: " + dateOnly(new Date(t)) : "");
  };

  // One persistent node per tab. Snapshots update them in the background, so typing a
  // comment is never interrupted and switching tabs is instant.
  const sections = {
    classroom: el("div", {}, el("h2", {}, "Classroom"), el("div", {}, loading("Loading courses…"))),
    classtests: el("div", {}, el("h2", {}, "Class Tests"), el("div", { class: "list" }, loading("Loading class tests…"))),
    tasks: el("div", {}, el("h2", {}, "Tasks"), el("div", { class: "list" }, loading("Loading tasks…"))),
    notices: el("div", {}, el("h2", {}, "Notices"), el("div", { class: "list" }, loading("Loading notices…"))),
    comments: el("div", {}, el("h2", {}, "Comments")),
  };
  const box = (id) => sections[id].lastElementChild;

  const watch = (col, id, dir, draw) =>
    unsubs.push(onSnapshot(query(collection(db, col), orderBy(col === "tasks" ? "start" : "createdAt", dir)),
      (s) => {
        const items = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (col !== "comments") {
          last[col] = Math.max(0, ...items.map((i) => i.createdAt?.toMillis?.() || 0));
          setByline();
        }
        draw(items);
      },
      (err) => [].concat(id).forEach((x) => box(x).replaceChildren(failed(err)))));

  watch("courses", "classroom", "asc", (items) =>
    box("classroom").replaceChildren(items.length ? classroomTable(items) : empty("No courses yet.", "The CR adds them from the admin panel.")));

  // One list of tasks from Firestore, shown in two tabs: class tests, and everything else.
  let taskItems = [];
  const drawTasks = () => {
    const sorted = taskItems.slice().sort((a, b) => (taskStatus(a) === "done") - (taskStatus(b) === "done"));
    const fill = (id, list, none) => box(id).replaceChildren(...(list.length ? list.map((t) => taskCard(t)) : [none]));
    fill("classtests", sorted.filter(isClassTest), empty("No class tests yet.", "New ones appear here as soon as the CR adds them."));
    fill("tasks", sorted.filter((t) => !isClassTest(t)), empty("No tasks yet.", "Assignments, quizzes, labs and exams show up here."));
  };
  watch("tasks", ["classtests", "tasks"], "asc", (items) => { taskItems = items; drawTasks(); });
  const tick = setInterval(drawTasks, 30000);
  unsubs.push(() => clearInterval(tick));

  watch("notices", "notices", "desc", (items) =>
    box("notices").replaceChildren(...(items.length ? items.map((n) => noticeCard(n)) : [empty("No notices yet.", "Announcements from the CR will be listed here.")])));

  const text = el("textarea", { placeholder: "Share a note with the class", maxlength: "500", required: "", rows: "3" });
  const msg = el("p", { class: "error", role: "alert" });
  const list = el("div", { class: "list" }, loading("Loading comments…"));
  sections.comments.append(
    el("form", { class: "card", onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = "";
      const t = text.value.trim(); if (!t) return;
      try {
        await addDoc(collection(db, "comments"), {
          text: t, uid: user.uid, name: auth.currentUser.displayName || "Student", createdAt: serverTimestamp(),
        });
        text.value = "";
      } catch (err) { msg.textContent = errMsg(err); }
    } }, labeled("Your comment", text), msg, el("button", { class: "btn", type: "submit" }, "Post comment")),
    list);
  watch("comments", "comments", "desc", (items) =>
    list.replaceChildren(...(items.length ? items.map((c) => commentItem(c)) : [empty("No comments yet.", "Be the first to write one.")])));

  const { bar, body } = tabs(
    [["classroom", "Classroom"], ["classtests", "Class Tests"], ["tasks", "Tasks"], ["notices", "Notices"], ["comments", "Comments"]],
    (id, b) => b.replaceChildren(sections[id]));

  root.replaceChildren(
    el("header", { class: "masthead" }, el("div", { class: "wrap" },
      el("div", {}, el("h1", {}, "Class Hub"), byline),
      el("div", { class: "mast-actions" },
        el("span", { class: "who" }, user.displayName || user.email),
        el("button", { class: "btn ghost", onclick: () => signOut(auth) }, "Log out")))),
    el("main", { class: "wrap shell" }, el("div", { class: "layout" }, bar, body)),
    el("footer", { class: "wrap foot" }, "Times follow your device's time zone. Task status updates by itself as the time passes."));
}
