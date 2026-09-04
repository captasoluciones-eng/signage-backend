import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase";

// Browsers/extensions that block popups (Safari's default popup policy,
// strict privacy extensions, some in-app/embedded webviews) throw
// auth/popup-blocked or auth/operation-not-supported-in-this-environment
// from signInWithPopup. Falling back to a full-page redirect keeps sign-in
// working there too; onAuthStateChanged below picks up the resulting
// session once the redirect completes and the page reloads.
const POPUP_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
]);

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [idToken, setIdToken] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const token = await firebaseUser.getIdToken();
        setIdToken(token);
      } else {
        setIdToken(null);
      }
    });
    return unsub;
  }, []);

  // Refresh the ID token periodically (Firebase tokens expire hourly).
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      const token = await user.getIdToken(true);
      setIdToken(token);
    }, 45 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);

  const signIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (POPUP_FALLBACK_CODES.has(err?.code)) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      throw err;
    }
  };
  const signOut = () => firebaseSignOut(auth);

  return (
    <AuthContext.Provider value={{ user, idToken, signIn, signOut, loading: user === undefined }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
