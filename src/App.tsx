import { useCallback, useEffect, useState } from "react";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { loadSessions, loadSettings } from "./lib/data";
import { loadCheckins, loadExercises, loadTemplates, loadWorkouts } from "./lib/strengthData";
import type { Checkin } from "./lib/readiness";
import { todaysCheckin } from "./lib/readiness";
import ReadinessScan from "./components/ReadinessScan";
import type { Session, Settings } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import type { Exercise, Template, Workout } from "./lib/strength";
import Auth from "./components/Auth";
import WeekView from "./components/WeekView";
import History from "./components/History";
import Progress from "./components/Progress";
import SettingsView from "./components/SettingsView";
import SessionEditor, { hasDraft as hasCardioDraft } from "./components/SessionEditor";
import TabBar, { type Tab } from "./components/TabBar";
import Train from "./components/Train";
import WorkoutLogger, { hasWorkoutDraft } from "./components/WorkoutLogger";
import WorkoutSummary from "./components/WorkoutSummary";
import TemplateEditor from "./components/TemplateEditor";
import ExerciseLibrary from "./components/ExerciseLibrary";
import ExerciseDetail from "./components/ExerciseDetail";

export type View =
  | { k: "tabs" }
  | { k: "cardio"; session: Session | null }
  | { k: "workout"; workout: Workout | null; template: Template | null }
  | { k: "summary"; workoutId: string }
  | { k: "template"; template: Template | null }
  | { k: "exercise"; id: string }
  | { k: "settings" }
  | { k: "readiness"; checkin: Checkin | null; next: "home" | "resume" | { template: Template | null } };

function initialView(): View {
  if (hasWorkoutDraft()) return { k: "workout", workout: null, template: null };
  if (hasCardioDraft()) return { k: "cardio", session: null };
  return { k: "tabs" };
}

export interface AppData {
  sessions: Session[];
  settings: Settings;
  exercises: Exercise[];
  templates: Template[];
  workouts: Workout[];
  checkins: Checkin[];
}

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  const [data, setData] = useState<AppData>({ sessions: [], settings: DEFAULT_SETTINGS, exercises: [], templates: [], workouts: [], checkins: [] });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("week");
  const [view, setView] = useState<View>(initialView);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuth(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = auth?.user.id;

  const refresh = useCallback(async () => {
    try {
      const [sessions, settings, exercises, templates, workouts, checkins] = await Promise.all([
        loadSessions(), loadSettings(), loadExercises(), loadTemplates(), loadWorkouts(), loadCheckins(),
      ]);
      setData({ sessions, settings, exercises, templates, workouts, checkins });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your data.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (userId) refresh();
    else setLoaded(false);
  }, [userId, refresh]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, view.k]);

  if (auth === undefined) return <div className="center-load">Loading…</div>;
  if (!auth) return <Auth />;

  const go = (v: View) => setView(v);
  const home = (t?: Tab) => {
    if (t) setTab(t);
    setView({ k: "tabs" });
  };
  const { sessions, settings, exercises, templates, workouts, checkins } = data;
  const today = todaysCheckin(checkins);
  // Starting a workout: scan first if there's no scan today
  const startWorkout = (template: Template | null) =>
    go(today ? { k: "workout", workout: null, template } : { k: "readiness", checkin: null, next: { template } });

  let body;
  if (!loaded) {
    body = <div className="center-load">Loading…</div>;
  } else if (view.k === "cardio") {
    body = (
      <SessionEditor
        session={view.session}
        allSessions={sessions}
        settings={settings}
        onClose={() => home()}
        onSaved={async () => { home("week"); await refresh(); }}
        onDeleted={async () => { home(); await refresh(); }}
      />
    );
  } else if (view.k === "workout") {
    body = (
      <WorkoutLogger
        workout={view.workout}
        template={view.template}
        data={data}
        onClose={() => home()}
        onCreatedExercise={refresh}
        checkin={view.workout ? null : today}
        onScan={() => go({ k: "readiness", checkin: null, next: "resume" })}
        onSaved={async (id, isNew) => {
          await refresh();
          if (isNew) go({ k: "summary", workoutId: id });
          else home("history");
        }}
        onDeleted={async () => { home("history"); await refresh(); }}
      />
    );
  } else if (view.k === "readiness") {
    const next = view.next;
    const proceed = () => {
      if (next === "home") home();
      else if (next === "resume") go({ k: "workout", workout: null, template: null });
      else go({ k: "workout", workout: null, template: next.template });
    };
    const existing = view.checkin ?? (next === "home" ? null : today);
    body = (
      <ReadinessScan
        existing={existing}
        checkins={checkins}
        saveLabel={next === "home" ? "Save scan" : next === "resume" ? "Save and back to workout" : `Save and start ${next.template?.name ?? "workout"}`}
        onSaved={async (c) => {
          setData((d) => ({ ...d, checkins: [c, ...d.checkins.filter((x) => x.id !== c.id)].sort((a, b) => b.checked_at.localeCompare(a.checked_at)) }));
          proceed();
          refresh();
        }}
        onSkip={next === "home" ? undefined : () => (next === "resume" ? go({ k: "workout", workout: null, template: null }) : go({ k: "workout", workout: null, template: next.template }))}
        onCancel={() => (next === "resume" ? go({ k: "workout", workout: null, template: null }) : home())}
        onDeleted={async () => { home(); await refresh(); }}
      />
    );
  } else if (view.k === "summary") {
    body = <WorkoutSummary workoutId={view.workoutId} data={data} onDone={() => home("week")} onEdit={(w) => go({ k: "workout", workout: w, template: null })} />;
  } else if (view.k === "template") {
    body = (
      <TemplateEditor
        template={view.template}
        data={data}
        onClose={() => home("train")}
        onSaved={async () => { await refresh(); home("train"); }}
        onCreatedExercise={refresh}
      />
    );
  } else if (view.k === "exercise") {
    body = (
      <ExerciseDetail
        exerciseId={view.id}
        data={data}
        onBack={() => home()}
        onChanged={refresh}
        onOpenWorkout={(w) => go({ k: "summary", workoutId: w.id })}
      />
    );
  } else if (view.k === "settings") {
    body = (
      <SettingsView
        settings={settings}
        sessions={sessions}
        workouts={workouts}
        exercises={exercises}
        email={auth.user.email ?? ""}
        onSaved={(s) => setData((d) => ({ ...d, settings: s }))}
        onBack={() => home()}
      />
    );
  } else if (tab === "week") {
    body = (
      <WeekView
        data={data}
        onLogCardio={() => go({ k: "cardio", session: null })}
        onOpenSession={(s) => go({ k: "cardio", session: s })}
        onOpenWorkout={(w) => go({ k: "summary", workoutId: w.id })}
        onTrain={() => home("train")}
        goSettings={() => go({ k: "settings" })}
        onScan={(c) => go({ k: "readiness", checkin: c, next: "home" })}
      />
    );
  } else if (tab === "history") {
    body = (
      <History
        data={data}
        onOpenSession={(s) => go({ k: "cardio", session: s })}
        onOpenWorkout={(w) => go({ k: "summary", workoutId: w.id })}
        onTrain={() => home("train")}
      />
    );
  } else if (tab === "train") {
    body = (
      <Train
        data={data}
        onLogCardio={() => go({ k: "cardio", session: null })}
        onStart={startWorkout}
        onResume={() => go({ k: "workout", workout: null, template: null })}
        onEditTemplate={(t) => go({ k: "template", template: t })}
        onChanged={refresh}
      />
    );
  } else if (tab === "exercises") {
    body = <ExerciseLibrary data={data} onOpen={(id) => go({ k: "exercise", id })} onChanged={refresh} />;
  } else {
    body = <Progress data={data} onLog={() => home("train")} onOpenExercise={(id) => go({ k: "exercise", id })} onOpenCheckin={(c) => go({ k: "readiness", checkin: c, next: "home" })} />;
  }

  const activeTab: Tab = view.k === "tabs" ? tab : view.k === "cardio" || view.k === "workout" || view.k === "template" || (view.k === "readiness" && view.next !== "home") ? "train" : view.k === "exercise" ? "exercises" : tab;

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
      <TabBar tab={activeTab} onTab={(t) => home(t)} />
    </>
  );
}
