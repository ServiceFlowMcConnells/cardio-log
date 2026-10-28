import { useCallback, useEffect, useState } from "react";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { loadSessions, loadSettings } from "./lib/data";
import type { Session, Settings } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import Auth from "./components/Auth";
import WeekView from "./components/WeekView";
import History from "./components/History";
import Progress from "./components/Progress";
import SettingsView from "./components/SettingsView";
import SessionEditor, { hasDraft } from "./components/SessionEditor";
import TabBar, { type Tab } from "./components/TabBar";

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("week");
  // null = closed, "new" = new session, otherwise the session being edited
  const [editing, setEditing] = useState<Session | "new" | null>(() => (hasDraft() ? "new" : null));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuth(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = auth?.user.id;

  const refresh = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([loadSessions(), loadSettings()]);
      setSessions(s);
      setSettings(st);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your sessions.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (userId) refresh();
    else {
      setSessions([]);
      setLoaded(false);
    }
  }, [userId, refresh]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, editing]);

  if (auth === undefined) return <div className="center-load">Loading…</div>;
  if (!auth) return <Auth />;

  const openNew = () => setEditing("new");
  const openEdit = (s: Session) => setEditing(s);

  let body;
  if (editing) {
    body = (
      <SessionEditor
        session={editing === "new" ? null : editing}
        allSessions={sessions}
        settings={settings}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          setTab("week");
          await refresh();
        }}
        onDeleted={async () => {
          setEditing(null);
          await refresh();
        }}
      />
    );
  } else if (!loaded) {
    body = <div className="center-load">Loading your sessions…</div>;
  } else if (tab === "week") {
    body = <WeekView sessions={sessions} settings={settings} onLog={openNew} onOpen={openEdit} goSettings={() => setTab("settings")} />;
  } else if (tab === "history") {
    body = <History sessions={sessions} settings={settings} onOpen={openEdit} onLog={openNew} />;
  } else if (tab === "progress") {
    body = <Progress sessions={sessions} settings={settings} onLog={openNew} />;
  } else {
    body = <SettingsView settings={settings} sessions={sessions} email={auth.user.email ?? ""} onSaved={setSettings} />;
  }

  return (
    <>
      <main className="app">
        {loadError && (
          <div className="banner">
            <p>{loadError}</p>
            <button className="link small" onClick={refresh}>Try again</button>
          </div>
        )}
        {body}
      </main>
      <TabBar
        tab={editing ? "log" : tab}
        onTab={(t) => {
          if (t === "log") openNew();
          else {
            setEditing(null);
            setTab(t);
          }
        }}
      />
    </>
  );
}
