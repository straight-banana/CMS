import { auth, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail } from "./firebase.js";
import { el, errMsg } from "./common.js";

const IGNORED = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];

export const googleButton = (msg) =>
  el("button", { type: "button", class: "btn ghost wide", onclick: async () => {
    msg.textContent = "";
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (err) { if (!IGNORED.includes(err.code)) msg.textContent = errMsg(err); }
  } }, "Continue with Google");

export const divider = () => el("div", { class: "or" }, "or");

// Sends Firebase's reset email to whatever is typed in the email field.
export const forgotLink = (emailInput, msg, note) =>
  el("button", { type: "button", class: "link small forgot", onclick: async () => {
    msg.textContent = ""; note.textContent = "";
    const email = emailInput.value.trim();
    if (!email) { msg.textContent = "Type your email above, then select Forgot password again."; return; }
    try {
      await sendPasswordResetEmail(auth, email);
      note.textContent = `If ${email} has an account, a reset link is on its way. Check the spam folder too.`;
    } catch (err) { msg.textContent = errMsg(err); }
  } }, "Forgot password?");
