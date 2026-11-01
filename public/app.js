import { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile, collection, query, orderBy, onSnapshot, addDoc,
  serverTimestamp } from "./firebase.js";
import { el, errMsg, courseCard, noticeCard, commentItem, empty, taskCard, taskStatus } from "./common.js";

const root = document.getElementById("app");
let unsubs = [];
const stop = () => { unsubs.forEach((u) => u()); unsubs = []; };

onAuthStateChanged(auth, (user) => (user ? renderHub(user) : renderAuth("login")));

function renderAuth(mode) {
  stop();
  const msg = el("p", { class: "error", role: "alert" });
  const name = el("input", { placeholder: "Full name", autocomplete: "name", required: "", maxlength: "60" });
  const email = el("input", { type: "email", placeholder: "Email", autocomplete: "email", required: "" });
  const pass = el("input", { type: "password", placeholder: "Password (min 6 characters)", required: "",
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
  } }, mode === "register" ? name : null, email, pass, msg, btn);

  const swap = el("button", { class: "link", type: "button",
    onclick: () => renderAuth(mode === "login" ? "register" : "login") },
    mode === "login" ? "New here? Create an account" : "Already registered? Log in");

  root.replaceChildren(el("main", { class: "auth" },
    el("h1", {}, "Class Hub"),
    el("p", { class: "muted" }, mode === "login" ? "Log in to see your class info." : "Create your student account."),
    el("div", { class: "card" }, form), swap));
}

function renderHub(user) {
  stop();
  const notices = el("div", { class: "grid" });
  const courses = el("div", { class: "grid" });
  const tasks = el("div", { class: "grid" });
  const list = el("div", { class: "comments" });
  const text = el("textarea", { placeholder: "Write a comment…", maxlength: "500", required: "", rows: "3" });
  const msg = el("p", { class: "error", role: "alert" });

  const form = el("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = "";
    const t = text.value.trim(); if (!t) return;
    try {
      await addDoc(collection(db, "comments"), {
        text: t, uid: user.uid, name: auth.currentUser.displayName || "Student", createdAt: serverTimestamp(),
      });
      text.value = "";
    } catch (err) { msg.textContent = errMsg(err); }
  } }, text, msg, el("button", { class: "btn", type: "submit" }, "Post comment"));

  const watch = (col, dir, box, render, none) =>
    unsubs.push(onSnapshot(query(collection(db, col), orderBy("createdAt", dir)),
      (s) => box.replaceChildren(...(s.empty ? [empty(none)] : s.docs.map((d) => render(d.data())))),
      (err) => box.replaceChildren(empty(errMsg(err)))));
  watch("notices", "desc", notices, (n) => noticeCard(n), "No notices yet.");
  // Tasks: re-drawn every 30s so cards turn "Done" by themselves when their time passes.
  let taskDocs = null;
  const drawTasks = () => {
    if (!taskDocs) return;
    const sorted = taskDocs.slice().sort((a, b) => (taskStatus(a) === "done") - (taskStatus(b) === "done")); // done → bottom
    tasks.replaceChildren(...(sorted.length ? sorted.map((t) => taskCard(t)) : [empty("No tasks yet.")]));
  };
  unsubs.push(onSnapshot(query(collection(db, "tasks"), orderBy("start", "asc")),
    (s) => { taskDocs = s.docs.map((d) => d.data()); drawTasks(); },
    (err) => tasks.replaceChildren(empty(errMsg(err)))));
  const tick = setInterval(drawTasks, 30000);
  unsubs.push(() => clearInterval(tick));
  watch("courses", "asc", courses, (c) => courseCard(c), "No courses added yet.");
  watch("comments", "desc", list, (c) => commentItem(c), "No comments yet. Be the first!");

  root.replaceChildren(
    el("header", { class: "top" },
      el("strong", {}, "Class Hub"),
      el("div", { class: "right" },
        el("span", { class: "muted small" }, user.displayName || user.email),
        el("button", { class: "btn ghost", onclick: () => signOut(auth) }, "Log out"))),
    el("main", {},
      el("h2", {}, "📢 Notices"), notices,
      el("h2", {}, "🗓️ Tasks & deadlines"), tasks,
      el("h2", {}, "📚 Courses"), courses,
      el("h2", {}, "💬 Comments"), form, list));
}
