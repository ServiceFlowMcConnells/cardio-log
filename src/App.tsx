import { useCallback, useEffect, useState } from "react";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { loadSessions, loadSettings } from "./lib/data";
import { loadExercises, loadTemplates, loadWorkouts } from "./lib/strengthData";
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
  | { k: "settings" };

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
}

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  const [data, setData] = useState<AppData>({ sessions: [], settings: DEFAULT_SETTINGS, exercises: [], templates: [], workouts: [] });
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
      const [sessions, settings, exercises, templates, workouts] = await Promise.all([
        loadSessions(), loadSettings(), loadExercises(), loadTemplates(), loadWorkouts(),
      ]);
      setData({ sessions, settings, exercises, templates, workouts });
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
  const { sessions, settings, exercises, templates, workouts } = data;

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
        onSaved={async (id, isNew) => {
          await refresh();
          if (isNew) go({ k: "summary", workoutId: id });
          else home("history");
        }}
        onDeleted={async () => { home("history"); await refresh(); }}
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
        onStart={(t) => go({ k: "workout", workout: null, template: t })}
        onResume={() => go({ k: "workout", workout: null, template: null })}
        onEditTemplate={(t) => go({ k: "template", template: t })}
        onChanged={refresh}
      />
    );
  } else if (tab === "exercises") {
    body = <ExerciseLibrary data={data} onOpen={(id) => go({ k: "exercise", id })} onChanged={refresh} />;
  } else {
    body = <Progress data={data} onLog={() => home("train")} onOpenExercise={(id) => go({ k: "exercise", id })} />;
  }

  const activeTab: Tab = view.k === "tabs" ? tab : view.k === "cardio" || view.k === "workout" || view.k === "template" ? "train" : view.k === "exercise" ? "exercises" : tab;

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
