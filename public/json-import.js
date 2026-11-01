import { db, collection, getDocs, writeBatch, doc, Timestamp } from "./firebase.js";
import { el, errMsg } from "./common.js";
import { parseJsonText, dedupeKey, EXAMPLE, MAX_FILE_BYTES, TYPES } from "./data-format.js";

const SECTIONS = [["courses", "Classroom", "course"], ["tasks", "Tasks", "task"], ["notices", "Notices", "notice"]];
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const off = (cond) => (cond ? { disabled: "" } : {});     // el() sets any attribute it is given, so leave it out instead of passing null
const kb = (b) => (b < 1024 ? `${b} B` : `${Math.round(b / 1024)} KB`);

// A record from a file -> the document stored in Firestore.
export const toDoc = (col, r, ms) => {
  const d = { ...r, createdAt: Timestamp.fromMillis(ms) };      // createdAt keeps the order of the file
  if (col === "tasks") { d.start = Timestamp.fromDate(r.start); d.end = r.end ? Timestamp.fromDate(r.end) : null; }
  return d;
};

async function loadExisting() {
  const o = {};
  for (const [c] of SECTIONS) o[c] = new Set((await getDocs(collection(db, c))).docs.map((d) => dedupeKey(c, d.data())));
  return o;
}

// Combine every valid file into one list per collection and sort each record into: new, already there, repeated.
function plan(entries, existing, skipDupes) {
  const res = {}, seen = {};
  for (const [c] of SECTIONS) { res[c] = { fresh: [], dupes: 0, invalid: 0 }; seen[c] = new Set(); }
  for (const e of entries) {
    if (!e.result.parsed) continue;
    for (const [c] of SECTIONS) {
      const p = e.result.parsed[c];
      res[c].invalid += p.skipped.length;
      for (const rec of p.recs) {
        const k = dedupeKey(c, rec);
        if (skipDupes && ((existing && existing[c].has(k)) || seen[c].has(k))) { res[c].dupes++; continue; }
        seen[c].add(k); res[c].fresh.push(rec);
      }
    }
  }
  return res;
}

export function jsonImportView() {
  let entries = [];           // one per chosen file: { id, name, size, result }
  let existing = null;        // what is already on the site, fetched once per batch of files
  let existingErr = "", loading = false, busy = false, note = null, progress = "";

  const dyn = el("div");
  const skip = el("input", { type: "checkbox", checked: "" });
  skip.addEventListener("change", () => { existingErr = ""; render(); });

  // ---------- reading files ----------
  async function addFiles(files) {
    note = null;
    for (const f of files) {
      const id = `${f.name}|${f.size}|${f.lastModified}`;
      if (entries.some((e) => e.id === id)) continue;
      let result;
      if (!/\.json$/i.test(f.name) && f.type !== "application/json") result = { error: "This is not a .json file." };
      else if (f.size > MAX_FILE_BYTES) result = { error: `This file is ${kb(f.size)}. The limit is ${kb(MAX_FILE_BYTES)}.` };
      else { try { result = parseJsonText(await f.text()); } catch { result = { error: "The browser could not read this file." }; } }
      entries.push({ id, name: f.name, size: f.size, result });
    }
    render();
  }

  // ---------- importing ----------
  async function run(p) {
    busy = true; note = null; render();
    const todo = SECTIONS.map(([c]) => [c, p[c].fresh]).filter(([, r]) => r.length);
    const total = todo.reduce((a, [, r]) => a + r.length, 0);
    const base = Date.now();
    let done = 0;
    try {
      for (const [c, recs] of todo) {
        for (let i = 0; i < recs.length; i += 400) {                    // a Firestore batch holds 500 writes at most
          const chunk = recs.slice(i, i + 400), b = writeBatch(db);
          chunk.forEach((r, k) => b.set(doc(collection(db, c)), toDoc(c, r, base + done + k)));
          await b.commit();
          done += chunk.length; progress = `Imported ${done} of ${total}…`; render();
        }
      }
      const parts = SECTIONS.filter(([c]) => p[c].fresh.length).map(([c, , w]) => count(p[c].fresh.length, w));
      note = { ok: true, text: `Imported ${parts.join(", ")}.` };
      entries = [];
    } catch (e) {
      note = { ok: false, text: `${errMsg(e)} ${done} of ${total} items were saved before it stopped. ` +
        (skip.checked ? "Press Import again: the saved ones are skipped as duplicates." : "") };
    }
    existing = null; existingErr = ""; busy = false; progress = ""; render();
  }

  async function fetchExisting() {
    loading = true; render();
    try { existing = await loadExisting(); } catch (e) { existingErr = errMsg(e); }
    loading = false; render();
  }

  // ---------- drawing ----------
  function render() {
    const valid = entries.filter((e) => e.result.parsed);
    if (valid.length && skip.checked && !existing && !loading && !existingErr) fetchExisting();
    const p = plan(entries, existing, skip.checked);
    const fresh = SECTIONS.reduce((a, [c]) => a + p[c].fresh.length, 0);
    const kids = [];

    if (note) kids.push(el("p", { class: note.ok ? "ok" : "error", role: "status" }, note.text));

    if (entries.length) {
      kids.push(el("div", { class: "stack files" }, ...entries.map((e) => {
        const r = e.result;
        const sum = r.error ? el("span", { class: "error" }, r.error)
          : el("span", { class: "muted small" }, SECTIONS.map(([c, , w]) => r.parsed[c].recs.length ? count(r.parsed[c].recs.length, w) : null)
              .filter(Boolean).join(", ") || "No usable rows");
        return el("div", { class: "file-row" },
          el("div", {}, el("strong", { class: "fname" }, e.name), " ", el("span", { class: "muted small" }, kb(e.size)), el("br"), sum),
          el("button", { class: "btn ghost", type: "button", ...off(busy), "aria-label": `Remove ${e.name}`,
            onclick: () => { entries = entries.filter((x) => x !== e); existingErr = ""; render(); } }, "Remove"));
      })));
    }

    if (valid.length) {
      const rows = SECTIONS.filter(([c]) => p[c].fresh.length || p[c].dupes || p[c].invalid);
      kids.push(el("div", { class: "table-wrap sum" }, el("table", { class: "doc" },
        el("thead", {}, el("tr", {}, ...["", "Will import", "Duplicates skipped", "Invalid rows skipped"].map((h) => el("th", { scope: "col" }, h)))),
        el("tbody", {}, ...rows.map(([c, label]) => el("tr", {},
          el("td", { "data-label": "Section" }, label),
          el("td", { "data-label": "Will import" }, String(p[c].fresh.length)),
          el("td", { "data-label": "Duplicates skipped" }, loading && !existing ? "…" : String(p[c].dupes)),
          el("td", { "data-label": "Invalid rows skipped" }, String(p[c].invalid))))))));

      const notes = [];
      for (const e of valid) {
        const r = e.result.parsed;
        for (const [c] of SECTIONS) {
          r[c].skipped.forEach((s) => notes.push(`${e.name}: ${s.where} ${s.why}`));
          if (r[c].ignored.size) notes.push(`${e.name}: ignored fields in ${c}: ${[...r[c].ignored].join(", ")}`);
        }
        if (r.unknown.length) notes.push(`${e.name}: ignored keys: ${r.unknown.join(", ")}`);
      }
      if (notes.length) kids.push(el("details", { class: "problems" }, el("summary", {}, `Details (${notes.length})`),
        el("ul", {}, ...notes.slice(0, 40).map((n) => el("li", { class: "small" }, n)),
          notes.length > 40 ? el("li", { class: "small muted" }, `…and ${notes.length - 40} more`) : null)));

      if (existingErr) kids.push(el("p", { class: "error" }, `Could not check what is already on the site: ${existingErr} Untick the box above to import without checking.`));
      const wait = skip.checked && !existing && !existingErr;
      kids.push(el("div", { class: "actions" },
        el("button", { class: "btn", type: "button", ...off(busy || wait || !fresh || existingErr), onclick: () => run(p) },
          busy ? progress || "Importing…" : wait ? "Checking existing data…" : fresh ? `Import ${count(fresh, "item")}` : "Nothing new to import"),
        el("button", { class: "btn ghost", type: "button", ...off(busy),
          onclick: () => { entries = []; existing = null; existingErr = ""; render(); } }, "Clear")));
    }
    dyn.replaceChildren(...kids);
  }

  // ---------- the part that does not change ----------
  const input = el("input", { type: "file", accept: ".json,application/json", multiple: "", "aria-label": "Choose JSON files" });
  input.addEventListener("change", () => { addFiles([...input.files]); input.value = ""; });
  const zone = el("div", { class: "drop" }, el("p", {}, "Drop JSON files here, or choose them"), input);
  ["dragenter", "dragover"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));

  const downloadExample = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(EXAMPLE, null, 2)], { type: "application/json" }));
    el("a", { href: url, download: "class-hub-example.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return el("div", { class: "card json-import" },
    el("h3", {}, "Import JSON files"),
    el("p", { class: "muted" }, "Choose one or many .json files at once. Each file can hold courses, tasks and notices together. You see a preview before anything is saved."),
    zone,
    el("label", { class: "check" }, skip, el("span", {}, "Skip items that are already on the site or repeated in the files")),
    dyn,
    el("details", { class: "problems" }, el("summary", {}, "File format"),
      el("p", { class: "small" }, `A file is an object with any of these lists: "courses", "tasks", "notices". `
        + `Task "type" is one of ${TYPES.join(", ")}. A date like "2026-11-09" is an all-day task (use it for class tests). `
        + `A date with a time, like "2026-11-12 23:59", is timed, and "end" is optional.`),
      el("pre", {}, JSON.stringify(EXAMPLE, null, 2)),
      el("button", { class: "btn ghost", type: "button", onclick: downloadExample }, "Download example file")));
}
