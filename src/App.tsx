import { useCallback, useEffect, useRef, useState } from "react";
import { useHistoryTrap } from "./lib/backNav";
import { DesktopContext, useDesktopMedia } from "./lib/desktop";
import Sidebar, { type DeskNav } from "./components/Sidebar";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { loadSessions, loadSettings } from "./lib/data";
import { loadCheckins, loadExercises, loadTemplates, loadWorkouts } from "./lib/strengthData";
import { loadMobilitySessions, loadMobilityTests, loadNiggles } from "./lib/mobilityData";
import type { MobilitySession, MobilityTest as MTest, Niggle } from "./lib/mobility";
import MobilityHome from "./components/MobilityHome";
import MobilityTest from "./components/MobilityTest";
import MobilityPlayer from "./components/MobilityPlayer";
import Niggles from "./components/Niggles";
import { useRestAlerts } from "./lib/useRestAlerts";
import type { Program } from "./lib/programs";
import { loadPrograms } from "./lib/programs";
import ProgramEditor from "./components/ProgramEditor";
import WeekPlanner from "./components/WeekPlanner";
import type { PlannedWorkout } from "./lib/schedule";
import { loadPlanned } from "./lib/schedule";
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
  | { k: "readiness"; checkin: Checkin | null; next: "home" | "resume" | { template: Template | null } }
  | { k: "program"; program: Program | null }
  | { k: "plan" }
  | { k: "mobility" }
  | { k: "mobility-test" }
  | { k: "niggles"; back: "mobility" | "home" }
  | { k: "mobility-play"; kind: "daily" | "prewarm"; template: Template | null; next: "mobility" | "home" | "resume" | "start" };

function initialView(): View {
  const desktop = window.matchMedia?.("(min-width: 1024px)").matches && !(window as unknown as { Capacitor?: unknown }).Capacitor;
  if (hasWorkoutDraft() && !desktop) return { k: "workout", workout: null, template: null };
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
  mobilityTests: MTest[];
  niggles: Niggle[];
  mobilitySessions: MobilitySession[];
  programs: Program[];
  activeProgramId: string | null;
  planned: PlannedWorkout[];
}

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  const [data, setData] = useState<AppData>({ sessions: [], settings: DEFAULT_SETTINGS, exercises: [], templates: [], workouts: [], checkins: [], mobilityTests: [], niggles: [], mobilitySessions: [], programs: [], activeProgramId: null, planned: [] });
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
  useRestAlerts(data.exercises);
  const desktop = useDesktopMedia();

  // Back button: previous screen, then the Week tab, then leave the app
  const stack = useRef<View[]>([]);
  useHistoryTrap(view.k === "tabs" && tab === "week", () => {
    if (view.k !== "tabs") {
      const prev = stack.current.pop();
      setView(prev ?? { k: "tabs" });
    } else if (tab !== "week") {
      setTab("week");
    }
  });

  const refresh = useCallback(async () => {
    try {
      const [sessions, settings, exercises, templates, workouts, checkins, mobilityTests, niggles, mobilitySessions, prog, planned] = await Promise.all([
        loadSessions(), loadSettings(), loadExercises(), loadTemplates(), loadWorkouts(), loadCheckins(),
        loadMobilityTests(), loadNiggles(), loadMobilitySessions(), loadPrograms(), loadPlanned(),
      ]);
      setData({ sessions, settings, exercises, templates, workouts, checkins, mobilityTests, niggles, mobilitySessions, programs: prog.programs, activeProgramId: prog.activeId, planned });
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

  // Steps in a flow (scan → workout → summary) aren't screens to go back to
  const TRANSIENT = new Set<View["k"]>(["readiness", "mobility-play", "mobility-test", "workout"]);
  const go = (v: View) => {
    if (view.k !== "tabs" && !TRANSIENT.has(view.k)) stack.current.push(view);
    setView(v);
  };
  const home = (t?: Tab) => {
    stack.current = [];
    if (t) setTab(t);
    setView({ k: "tabs" });
  };
  const { sessions, settings, exercises, templates, workouts, checkins } = data;
  const today = todaysCheckin(checkins);
  // Starting a workout: scan first if there's no scan today
  const startWorkout = (template: Template | null) => {
    if (desktop) return; // live recording is phone-only
    go(today ? { k: "workout", workout: null, template } : { k: "readiness", checkin: null, next: { template } });
  };

  const warmup = (t: Template, next: "start" | "resume" = "start") => go({ k: "mobility-play", kind: "prewarm", template: t, next });

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
        onWarmup={(t) => warmup(t, "resume")}
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
  } else if (view.k === "plan") {
    body = <WeekPlanner data={data} onClose={() => home()} onSaved={async () => { await refresh(); home(); }} onRefresh={refresh} />;
  } else if (view.k === "program") {
    body = <ProgramEditor program={view.program} data={data} onClose={() => home("train")} onSaved={async () => { await refresh(); home("train"); }} />;
  } else if (view.k === "mobility") {
    body = (
      <MobilityHome
        data={data}
        onBack={() => home()}
        onTest={() => go({ k: "mobility-test" })}
        onNiggles={() => go({ k: "niggles", back: "mobility" })}
        onPlay={(kind, t) => go({ k: "mobility-play", kind, template: t, next: "mobility" })}
      />
    );
  } else if (view.k === "mobility-test") {
    body = <MobilityTest previous={data.mobilityTests[0] ?? null} onClose={() => go({ k: "mobility" })} onSaved={async () => { await refresh(); go({ k: "mobility" }); }} />;
  } else if (view.k === "niggles") {
    const back = view.back;
    body = <Niggles niggles={data.niggles} onBack={() => (back === "home" ? home() : go({ k: "mobility" }))} onChanged={refresh} />;
  } else if (view.k === "mobility-play") {
    const { next, template } = view;
    const leave = () => {
      if (next === "start") startWorkout(template);
      else if (next === "resume") go({ k: "workout", workout: null, template: null });
      else if (next === "mobility") go({ k: "mobility" });
      else home();
    };
    body = (
      <MobilityPlayer
        key={`${view.kind}-${template?.id ?? ""}`}
        data={data}
        kind={view.kind}
        templateId={template?.id ?? null}
        doneLabel={next === "start" ? `Save and start ${template?.name ?? "workout"}` : next === "resume" ? "Save and back to workout" : "Save"}
        onClose={() => (next === "start" ? home() : leave())}
        onDone={async () => { await refresh(); leave(); }}
        onNiggles={async () => { await refresh(); go({ k: "niggles", back: next === "home" ? "home" : "mobility" }); }}
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
        onStart={startWorkout}
        onWarmup={(t) => warmup(t)}
        onPlan={() => go({ k: "plan" })}
        onMobility={() => go({ k: "mobility" })}
        onDailyMobility={() => go({ k: "mobility-play", kind: "daily", template: null, next: "home" })}
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
        onOpenExercise={(id) => go({ k: "exercise", id })}
        onWarmup={(t) => warmup(t)}
        onMobility={() => go({ k: "mobility" })}
        onDailyMobility={() => go({ k: "mobility-play", kind: "daily", template: null, next: "home" })}
        onEditProgram={(p) => go({ k: "program", program: p })}
        onPlan={() => go({ k: "plan" })}
      />
    );
  } else if (tab === "exercises") {
    body = <ExerciseLibrary data={data} onOpen={(id) => go({ k: "exercise", id })} onChanged={refresh} />;
  } else {
    body = <Progress data={data} onLog={() => home("train")} onOpenExercise={(id) => go({ k: "exercise", id })} onOpenCheckin={(c) => go({ k: "readiness", checkin: c, next: "home" })} onMobility={() => go({ k: "mobility" })} />;
  }

  const activeTab: Tab = view.k === "tabs" ? tab : view.k === "cardio" || view.k === "workout" || view.k === "template" || view.k === "program" || view.k === "plan" || view.k.startsWith("mobility") || view.k === "niggles" || (view.k === "readiness" && view.next !== "home") ? "train" : view.k === "exercise" ? "exercises" : tab;

  const banner = loadError && (
    <div className="banner">
      <p>{loadError}</p>
      <button className="link small" onClick={refresh}>Try again</button>
    </div>
  );

  if (desktop) {
    const deskActive: DeskNav = view.k === "plan" ? "plan" : view.k === "settings" ? "settings" : view.k.startsWith("mobility") || view.k === "niggles" ? "mobility" : activeTab;
    const onNav = (n: DeskNav) => {
      if (n === "plan") { stack.current = []; setView({ k: "plan" }); }
      else if (n === "settings") { stack.current = []; setView({ k: "settings" }); }
      else if (n === "mobility") { stack.current = []; setView({ k: "mobility" }); }
      else home(n);
    };
    // Editors and forms read best at a comfortable width; overview pages use the full width
    const narrow = ["cardio", "template", "program", "settings", "readiness", "workout", "mobility-test", "niggles", "mobility-play"].includes(view.k);
    return (
      <DesktopContext.Provider value={true}>
        <div className="desk-shell">
          <Sidebar active={deskActive} onNav={onNav} onLogCardio={() => go({ k: "cardio", session: null })} email={auth.user.email ?? ""} />
          <main className={`app desk${narrow ? " narrow" : ""}`}>
            {banner}
            {body}
          </main>
        </div>
      </DesktopContext.Provider>
    );
  }

  return (
    <>
      <main className="app">
        {banner}
        {body}
      </main>
      <TabBar tab={activeTab} onTab={(t) => home(t)} />
    </>
  );
}
