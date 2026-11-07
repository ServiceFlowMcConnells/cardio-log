import { useCallback, useEffect, useRef, useState } from "react";
import { useHistoryTrap } from "./lib/backNav";
import { DesktopContext, useDesktopMedia } from "./lib/desktop";
import { setWeekStart } from "./lib/dates";
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
import { loadPrograms, nextUp } from "./lib/programs";
import ProgramEditor from "./components/ProgramEditor";
import WeekPlanner from "./components/WeekPlanner";
import type { PlannedWorkout } from "./lib/schedule";
import { plannedTemplate } from "./lib/schedule";
import { loadPlanned } from "./lib/schedule";
import type { Checkin } from "./lib/readiness";
import { todaysCheckin } from "./lib/readiness";
import ReadinessScan from "./components/ReadinessScan";
import type { Session, Settings } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import type { DayActivity } from "./lib/health";
import { healthConnected, healthSupported, lastSync, loadActivity, syncHealth } from "./lib/health";
import type { Exercise, Template, Workout } from "./lib/strength";
import Auth from "./components/Auth";
import WeekView from "./components/WeekView";
import History from "./components/History";
import Progress from "./components/Progress";
import SettingsView from "./components/SettingsView";
import SessionEditor, { hasDraft as hasCardioDraft } from "./components/SessionEditor";
import TabBar, { type Tab } from "./components/TabBar";
import Train from "./components/Train";
import WorkoutLogger, { hasWorkoutDraft, readWorkoutDraft } from "./components/WorkoutLogger";
import ShortcutSheet, { ShortcutIcons } from "./components/ShortcutSheet";
import WeighInSheet from "./components/WeighInSheet";
import ProgressPhotos from "./components/photos/ProgressPhotos";
import WorkoutSummary from "./components/WorkoutSummary";
import TemplateEditor from "./components/TemplateEditor";
import ExerciseLibrary from "./components/ExerciseLibrary";
import ExerciseDetail from "./components/ExerciseDetail";
import type { Food, NutritionData, Recipe } from "./lib/nutrition";
import { EMPTY_NUTRITION, loadNutrition, targetFor, todayYmd, ymd } from "./lib/nutrition";
import FoodDay from "./components/food/FoodDay";
import FoodAdd from "./components/food/FoodAdd";
import FoodEditor from "./components/food/FoodEditor";
import RecipeEditor from "./components/food/RecipeEditor";
import TargetsEditor from "./components/food/TargetsEditor";
import WeightView from "./components/food/Weight";
import NutritionTrends from "./components/food/NutritionTrends";

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
  | { k: "mobility-play"; kind: "daily" | "prewarm"; template: Template | null; next: "mobility" | "home" | "resume" | "start" }
  | { k: "food-add"; time?: string; preselect?: string | null; start?: "scan" | "quick" | "search" }
  | { k: "food-edit"; food: Food | null; name?: string; barcode?: string; fromAdd?: boolean }
  | { k: "recipe"; recipe: Recipe | null; items?: { food_id: string; grams: number }[] }
  | { k: "targets" }
  | { k: "nutrition" }
  | { k: "weight" }
  | { k: "photos"; add?: boolean };

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
  nutrition: NutritionData;
  activity: DayActivity[]; // daily steps and sleep from Health Connect
}

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  const [data, setData] = useState<AppData>({ sessions: [], settings: DEFAULT_SETTINGS, exercises: [], templates: [], workouts: [], checkins: [], mobilityTests: [], niggles: [], mobilitySessions: [], programs: [], activeProgramId: null, planned: [], nutrition: EMPTY_NUTRITION, activity: [] });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("week");
  const [view, setView] = useState<View>(initialView);
  const [foodDay, setFoodDay] = useState(todayYmd);
  const [sheet, setSheet] = useState(false);
  const [weighIn, setWeighIn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
      const [sessions, settings, exercises, templates, workouts, checkins, mobilityTests, niggles, mobilitySessions, prog, planned, nutrition, activity] = await Promise.all([
        loadSessions(), loadSettings(), loadExercises(), loadTemplates(), loadWorkouts(), loadCheckins(),
        loadMobilityTests(), loadNiggles(), loadMobilitySessions(), loadPrograms(), loadPlanned(),
        loadNutrition().catch((e) => { console.warn("loadNutrition failed", e); return null; }),
        loadActivity().catch((e) => { console.warn("loadActivity failed", e); return null; }),
      ]);
      setWeekStart(settings.week_start);
      setData((d) => ({ sessions, settings, exercises, templates, workouts, checkins, mobilityTests, niggles, mobilitySessions, programs: prog.programs, activeProgramId: prog.activeId, planned, nutrition: nutrition ?? d.nutrition, activity: activity ?? d.activity }));
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

  // While typing on a phone, hide the tab bar and other bars pinned to the bottom: with the keyboard up they'd
  // sit just above it, on top of whatever field you're typing in
  useEffect(() => {
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === "TEXTAREA" || el.isContentEditable || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "range", "date", "datetime-local", "file"].includes((el as HTMLInputElement).type)));
    const on = (e: FocusEvent) => {
      if (!typing(e.target)) return;
      document.body.classList.add("kb-open");
      // Once the keyboard has opened, make sure the field is visible above it (and not under anything pinned)
      const el = e.target as HTMLElement;
      window.setTimeout(() => {
        if (document.activeElement !== el) return;
        const r = el.getBoundingClientRect(), vh = window.visualViewport?.height ?? window.innerHeight;
        if (r.bottom > vh - 16 || r.top < 0) el.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 320);
    };
    const off = () => window.setTimeout(() => { if (!typing(document.activeElement)) document.body.classList.remove("kb-open"); }, 50);
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => { document.removeEventListener("focusin", on); document.removeEventListener("focusout", off); document.body.classList.remove("kb-open"); };
  }, []);

  // Health Connect: in the Android app, once connected, pull new steps and sleep on open and when you come back to the app
  const reloadActivity = useCallback(() => loadActivity().then((activity) => setData((d) => ({ ...d, activity }))).catch(() => {}), []);
  useEffect(() => {
    if (!userId || !healthSupported()) return;
    const maybeSync = () => {
      if (document.visibilityState !== "visible" || !healthConnected()) return;
      const last = lastSync();
      if (last && Date.now() - last < 10 * 60000) return;
      syncHealth().then((n) => { if (n) reloadActivity(); }).catch((e) => console.warn("Health Connect sync failed", e));
    };
    maybeSync();
    document.addEventListener("visibilitychange", maybeSync);
    return () => document.removeEventListener("visibilitychange", maybeSync);
  }, [userId, reloadActivity]);

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
  const startWorkout = (base: Template | null) => {
    if (desktop) return; // live recording is phone-only
    // A planned workout uses that week's set adjustments, if you made any when planning
    const template = base ? plannedTemplate(base, data.planned) : null;
    go(today ? { k: "workout", workout: null, template } : { k: "readiness", checkin: null, next: { template } });
  };

  const setNutri = (f: (n: NutritionData) => NutritionData) => setData((d) => ({ ...d, nutrition: f(d.nutrition) }));
  // Leave a sub-screen for the one underneath it (or `to` in its place)
  const back = (to?: View) => {
    const prev = stack.current.pop();
    setView(to ?? prev ?? { k: "tabs" });
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
        hcSleep={data.activity.find((a) => a.day === (existing ? ymd(new Date(existing.checked_at)) : todayYmd())) ?? null}
        dayTarget={targetFor(data.nutrition.targets, existing ? ymd(new Date(existing.checked_at)) : todayYmd())?.kcal ?? null}
        dayWeight={data.nutrition.weights.find((x) => x.measured_on === (existing ? ymd(new Date(existing.checked_at)) : todayYmd()))?.weight_kg ?? null}
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
  } else if (view.k === "food-add") {
    body = (
      <FoodAdd
        key={`${foodDay}-${view.preselect ?? ""}`}
        nutri={data.nutrition}
        day={foodDay}
        time={view.time}
        preselect={view.preselect}
        start={view.start}
        setNutri={setNutri}
        onDone={() => home("food")}
        onNewFood={(name, barcode) => go({ k: "food-edit", food: null, name, barcode, fromAdd: true })}
        onEditFood={(f) => go({ k: "food-edit", food: f, fromAdd: true })}
        onNewRecipe={() => go({ k: "recipe", recipe: null })}
        onEditRecipe={(r) => go({ k: "recipe", recipe: r })}
      />
    );
  } else if (view.k === "food-edit") {
    const fromAdd = view.fromAdd;
    body = (
      <FoodEditor
        food={view.food}
        initialName={view.name}
        initialBarcode={view.barcode}
        setNutri={setNutri}
        onClose={() => back()}
        onSaved={(f) => back(fromAdd ? { k: "food-add", preselect: f.id } : undefined)}
      />
    );
  } else if (view.k === "recipe") {
    body = <RecipeEditor key={view.recipe?.id ?? "new"} recipe={view.recipe} initialItems={view.items} nutri={data.nutrition} setNutri={setNutri} onClose={() => back()} onSaved={() => back()} />;
  } else if (view.k === "nutrition") {
    body = (
      <>
        <div className="editor-bar">
          <div><h1>Nutrition trends</h1><p className="muted small">Daily averages, against your targets</p></div>
          <button className="btn ghost" onClick={() => back()}>Done</button>
        </div>
        <NutritionTrends nutri={data.nutrition} onOpenDay={(d) => { setFoodDay(d); home("food"); }} />
      </>
    );
  } else if (view.k === "targets") {
    body = <TargetsEditor nutri={data.nutrition} setNutri={setNutri} onClose={() => home("food")} />;
  } else if (view.k === "photos") {
    body = <ProgressPhotos key={view.add ? "add" : "list"} weights={data.nutrition.weights} startAdd={view.add} onBack={() => back()} onToast={(t) => { setToast(t); window.setTimeout(() => setToast(null), 2500); }} />;
  } else if (view.k === "weight") {
    body = <WeightView nutri={data.nutrition} checkins={checkins} setNutri={setNutri} onClose={() => back()} />;
  } else if (view.k === "settings") {
    body = (
      <SettingsView
        settings={settings}
        sessions={sessions}
        workouts={workouts}
        exercises={exercises}
        email={auth.user.email ?? ""}
        onSaved={(s) => { setWeekStart(s.week_start); setData((d) => ({ ...d, settings: s })); }}
        onBack={() => home()}
        activity={data.activity}
        onSynced={reloadActivity}
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
        onSteps={() => { try { localStorage.setItem("cardio-log:progress-mode", "body"); } catch { /* private mode */ } home("progress"); }}
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
        onExercises={() => home("exercises")}
      />
    );
  } else if (tab === "food") {
    body = (
      <FoodDay
        nutri={data.nutrition}
        day={foodDay}
        setDay={setFoodDay}
        setNutri={setNutri}
        onAdd={(time, start) => go({ k: "food-add", time, start })}
        onTargets={() => go({ k: "targets" })}
        onMakeRecipe={(items) => go({ k: "recipe", recipe: null, items })}
        onTrends={() => go({ k: "nutrition" })}
      />
    );
  } else if (tab === "exercises") {
    body = <ExerciseLibrary data={data} onOpen={(id) => go({ k: "exercise", id })} onChanged={refresh} />;
  } else {
    body = <Progress data={data} onLog={() => home("train")} onOpenExercise={(id) => go({ k: "exercise", id })} onOpenCheckin={(c) => go({ k: "readiness", checkin: c, next: "home" })} onMobility={() => go({ k: "mobility" })} onOpenFoodDay={(d) => { setFoodDay(d); home("food"); }} setNutri={setNutri} onPhotos={(add) => go({ k: "photos", add })} />;
  }

  const FOOD_VIEWS = new Set<View["k"]>(["food-add", "food-edit", "recipe", "targets", "weight", "nutrition"]);
  const activeTab: Tab = view.k === "tabs" ? (tab === "exercises" && !desktop ? "train" : tab) : FOOD_VIEWS.has(view.k) ? "food" : view.k === "exercise" && !desktop ? "train" : view.k === "cardio" || view.k === "workout" || view.k === "template" || view.k === "program" || view.k === "plan" || view.k.startsWith("mobility") || view.k === "niggles" || (view.k === "readiness" && view.next !== "home") ? "train" : view.k === "exercise" ? "exercises" : tab;

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
    const narrow = ["cardio", "template", "program", "settings", "readiness", "workout", "mobility-test", "niggles", "mobility-play", "food-edit", "recipe", "targets"].includes(view.k);
    return (
      <DesktopContext.Provider value={true}>
        <div className="desk-shell">
          <Sidebar active={deskActive} onNav={onNav} onLogCardio={() => go({ k: "cardio", session: null })} onLogFood={() => { setFoodDay(todayYmd()); stack.current = []; setView({ k: "food-add" }); }} email={auth.user.email ?? ""} />
          <main className={`app desk${narrow ? " narrow" : ""}`}>
            {banner}
            {body}
          </main>
        </div>
      </DesktopContext.Provider>
    );
  }

  // The + opens shortcuts: start training, log food, weigh in and so on
  const draft = readWorkoutDraft();
  const up = draft ? null : nextUp(data);
  const logFood = (start?: "scan" | "quick") => { setFoodDay(todayYmd()); stack.current = []; setView({ k: "food-add", start }); setTab("food"); };
  const quick = [
    {
      title: "Training",
      items: [
        draft
          ? { key: "workout", label: "Resume workout", sub: draft.name, icon: ShortcutIcons.workout, onClick: () => go({ k: "workout", workout: null, template: null }) }
          : { key: "workout", label: "Start workout", sub: up?.template.name ?? "Empty workout", icon: ShortcutIcons.workout, onClick: () => startWorkout(up?.template ?? null) },
        { key: "cardio", label: "Log cardio", icon: ShortcutIcons.cardio, onClick: () => go({ k: "cardio", session: null }) },
        { key: "scan", label: "Readiness", sub: today ? "Done today" : undefined, icon: ShortcutIcons.readiness, onClick: () => go({ k: "readiness", checkin: today ?? null, next: "home" }) },
        { key: "mobility", label: "Mobility", sub: "Daily routine", icon: ShortcutIcons.mobility, onClick: () => go({ k: "mobility-play", kind: "daily", template: null, next: "home" }) },
      ],
    },
    {
      title: "Food and body",
      items: [
        { key: "food", label: "Log food", icon: ShortcutIcons.food, onClick: () => logFood() },
        { key: "barcode", label: "Barcode", icon: ShortcutIcons.barcode, onClick: () => logFood("scan") },
        { key: "quick", label: "Quick add", icon: ShortcutIcons.quick, onClick: () => logFood("quick") },
        { key: "weight", label: "Weigh in", icon: ShortcutIcons.weight, onClick: () => setWeighIn(true) },
        { key: "photos", label: "Photos", icon: ShortcutIcons.photos, onClick: () => go({ k: "photos", add: true }) },
      ],
    },
  ];
  const links = [
    { key: "train", label: "Programs and templates", icon: ShortcutIcons.programs, onClick: () => home("train") },
    { key: "plan", label: "Plan my week", icon: ShortcutIcons.plan, onClick: () => go({ k: "plan" }) },
    { key: "trends", label: "Nutrition trends", icon: ShortcutIcons.trends, onClick: () => { setTab("food"); go({ k: "nutrition" }); } },
    { key: "library", label: "Exercise library", icon: ShortcutIcons.library, onClick: () => home("exercises") },
  ];

  return (
    <>
      <main className="app">
        {banner}
        {body}
      </main>
      <TabBar tab={activeTab} plusOpen={sheet} onTab={(t) => (t === "train" ? setSheet((o) => !o) : home(t))} />
      <ShortcutSheet open={sheet} onClose={() => setSheet(false)} quick={quick} links={links} />
      <WeighInSheet open={weighIn} onClose={() => setWeighIn(false)} nutri={data.nutrition} setNutri={setNutri}
        onSaved={(t) => { setToast(t); window.setTimeout(() => setToast(null), 2500); }} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
