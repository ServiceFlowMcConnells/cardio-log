import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Auth() {
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.functions
      .invoke("create-account", { method: "GET" })
      .then(({ data, error }) => setHasAccount(error ? true : Boolean(data?.hasAccount)))
      .catch(() => setHasAccount(true));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (hasAccount === false) {
        const { data, error } = await supabase.functions.invoke("create-account", { body: { email, password } });
        if (error) {
          let msg = "Couldn't create the account.";
          try {
            const body = await (error as { context?: Response }).context?.json();
            if (body?.error) msg = body.error;
          } catch { /* keep default */ }
          throw new Error(msg);
        }
        if (!data?.ok) throw new Error("Couldn't create the account.");
      }
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "Email or password is wrong." : error.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const creating = hasAccount === false;

  return (
    <main className="app">
      <div className="auth">
        <img className="mark" src="/icon.svg" alt="" />
        <h1>Cardio Log</h1>
        <p className="muted">
          {hasAccount === null ? "Checking…" : creating ? "Create your account. This app has one owner, so sign-ups close once you're in." : "Sign in to log your sessions."}
        </p>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password{creating ? " (at least 8 characters)" : ""}</span>
            <input
              className="input"
              type="password"
              autoComplete={creating ? "new-password" : "current-password"}
              required
              minLength={creating ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary block" disabled={busy || hasAccount === null}>
            {busy ? "One moment…" : creating ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
