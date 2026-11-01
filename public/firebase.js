import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export * from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
export * from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// 👉 Paste YOUR config from Firebase Console → Project settings → Your apps → Web app.
// (This config is public by design. Security comes from firestore.rules.)
const firebaseConfig = {
  apiKey: "AIzaSyAE8-PlTP0TRIvcoU3u6iyIBM66uIaablo",
  authDomain: "class-management-4caee.firebaseapp.com",
  projectId: "class-management-4caee",
  storageBucket: "class-management-4caee.firebasestorage.app",
  messagingSenderId: "1052033679048",
  appId: "1:1052033679048:web:fdfae5237071abe53faffd",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
