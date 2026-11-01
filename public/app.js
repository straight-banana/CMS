import { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile, collection, query, orderBy, onSnapshot, addDoc,
  serverTimestamp } from "./firebase.js";
import { googleButton, divider, forgotLink } from "./auth-ui.js";
import { el, errMsg, dateOnly, classroomTable, noticeCard, commentItem, taskCard, taskStatus,
  empty, tabs } from "./common.js";

const root = document.getElementById("app");
let unsubs = [];
const stop = () => { unsubs.forEach((u) => u()); unsubs = []; };

onAuthStateChanged(auth, (user) => (user ? renderHub(user) : renderAuth("login")));

function renderAuth(mode) {
  stop();
  const msg = el("p", { class: "error", role: "alert" });
  const note = el("p", { class: "ok small", role: "status" });
  const name = el("input", { placeholder: "Full name", autocomplete: "name", required: "", maxlength: "60" });
  const email = el("input", { type: "email", placeholder: "Email", autocomplete: "email", required: "" });
  const pass = el("input", { type: "password", placeholder: "Password, at least 6 characters", required: "",
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
  } }, mode === "register" ? name : null, email, pass, mode === "login" ? forgotLink(email, msg, note) : null, note, msg, btn);

  const seg = el("div", { class: "seg" }, ...[["login", "Log in"], ["register", "Create account"]].map(([m, l]) =>
    el("button", { type: "button", class: "seg-btn" + (m === mode ? " active" : ""), onclick: () => renderAuth(m) }, l)));

  root.replaceChildren(el("main", { class: "auth" },
    el("h1", {}, "Class Hub"),
    el("p", { class: "muted" }, "Student login. The class representative maintains this page."),
    el("div", { class: "card" }, seg, googleButton(msg), divider(), form)));
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
    classroom: el("div", {}, el("h2", {}, "Classroom"), el("div")),
    tasks: el("div", {}, el("h2", {}, "Tasks"), el("div", { class: "grid" })),
    notices: el("div", {}, el("h2", {}, "Notices"), el("div", { class: "grid" })),
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
      (err) => box(id).replaceChildren(empty(errMsg(err)))));

  watch("courses", "classroom", "asc", (items) =>
    box("classroom").replaceChildren(items.length ? classroomTable(items) : empty("No courses yet.")));

  let taskItems = [];
  const drawTasks = () => {
    const sorted = taskItems.slice().sort((a, b) => (taskStatus(a) === "done") - (taskStatus(b) === "done"));
    box("tasks").replaceChildren(...(sorted.length ? sorted.map((t) => taskCard(t)) : [empty("No tasks yet.")]));
  };
  watch("tasks", "tasks", "asc", (items) => { taskItems = items; drawTasks(); });
  const tick = setInterval(drawTasks, 30000);
  unsubs.push(() => clearInterval(tick));

  watch("notices", "notices", "desc", (items) =>
    box("notices").replaceChildren(...(items.length ? items.map((n) => noticeCard(n)) : [empty("No notices yet.")])));

  const text = el("textarea", { placeholder: "Write a comment", maxlength: "500", required: "", rows: "3" });
  const msg = el("p", { class: "error", role: "alert" });
  const list = el("div", { class: "stack" });
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
    } }, text, msg, el("button", { class: "btn", type: "submit" }, "Post")),
    list);
  watch("comments", "comments", "desc", (items) =>
    list.replaceChildren(...(items.length ? items.map((c) => commentItem(c)) : [empty("No comments yet.")])));

  const { bar, body } = tabs(
    [["classroom", "Classroom"], ["tasks", "Tasks"], ["notices", "Notices"], ["comments", "Comments"]],
    (id, b) => b.replaceChildren(sections[id]));

  root.replaceChildren(
    el("header", { class: "top" },
      el("span", { class: "muted small" }, user.displayName || user.email),
      el("button", { class: "btn ghost", onclick: () => signOut(auth) }, "Log out")),
    el("main", {}, el("h1", {}, "Class Hub"), byline, bar, body));
}
