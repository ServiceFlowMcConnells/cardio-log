// Mobility: a home, bodyweight-only screen and routine generator.
//
// Model (rules, not AI):
//  1. Screen: 8 self-tests, each rated Good / OK / Restricted, plus "it hurt". Gives a score per area and overall.
//  2. Niggles: body areas rated 1–5 and stiff / achy / sharp. Safety first: sharp, 4+ or a red flag
//     (numbness, tingling, swelling, night pain) takes the area out of routines and suggests a physio.
//  3. Daily routine (~10 min): the highest-priority areas get a range drill and a control drill (active
//     control helps keep new range). Priority = screen result + niggles + feedback + what your next
//     workout needs. Drills rotate day to day.
//  4. Pre-workout (~5 min), RAMP structure (Jeffreys): Raise (~1 min of easy movement), then Activate &
//     Mobilise the areas the template loads, using dynamic drills only. Long static holds before lifting
//     can blunt force output; dynamic work doesn't. Potentiate = your warm-up sets.
//  5. Feedback after each session (better / same / worse per area) moves drills up or down a level.

import type { Muscle, Template, Exercise } from "./strength";

export type Area = "ankle" | "hip" | "hamstring" | "hip_flexor" | "spine" | "shoulder" | "wrist" | "core" | "neck";
export const AREA_LABEL: Record<Area, string> = {
  ankle: "Ankles", hip: "Hips", hamstring: "Hamstrings", hip_flexor: "Hip flexors", spine: "Upper back",
  shoulder: "Shoulders", wrist: "Wrists", core: "Trunk control", neck: "Neck",
};
export const AREAS: Area[] = ["ankle", "hip", "hamstring", "hip_flexor", "spine", "shoulder", "wrist", "core", "neck"];

export type NiggleArea = "neck" | "shoulder" | "upper_back" | "elbow" | "wrist" | "lower_back" | "hip" | "knee" | "ankle";
export const NIGGLE_AREAS: NiggleArea[] = ["neck", "shoulder", "upper_back", "elbow", "wrist", "lower_back", "hip", "knee", "ankle"];
export const NIGGLE_LABEL: Record<NiggleArea, string> = {
  neck: "Neck", shoulder: "Shoulder", upper_back: "Upper back", elbow: "Elbow", wrist: "Wrist",
  lower_back: "Lower back", hip: "Hip", knee: "Knee", ankle: "Ankle",
};
/** Which mobility areas a niggle affects. `rest`: rested entirely when the niggle is sharp, strong or flagged.
 *  `near`: worked gently (and drills that load the sore joint are swapped out). */
const NIGGLE_MAP: Record<NiggleArea, { rest: Area[]; near: Area[] }> = {
  neck: { rest: ["neck"], near: ["spine"] },
  shoulder: { rest: ["shoulder"], near: ["spine"] },
  upper_back: { rest: ["spine"], near: ["shoulder", "neck"] },
  elbow: { rest: [], near: ["wrist"] },
  wrist: { rest: ["wrist"], near: [] },
  lower_back: { rest: ["core"], near: ["hip", "hip_flexor", "hamstring"] },
  hip: { rest: ["hip", "hip_flexor"], near: ["hamstring"] },
  knee: { rest: [], near: ["ankle", "hip"] },
  ankle: { rest: ["ankle"], near: [] },
};

export interface Niggle {
  id: string;
  area: NiggleArea;
  side: "left" | "right" | "both";
  level: number; // 1–5
  kind: "stiff" | "achy" | "sharp";
  red_flag: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export const isBlocked = (n: Niggle) => n.kind === "sharp" || n.level >= 4 || n.red_flag;

// ---------- Screen ----------

export interface MobilityTestDef {
  id: string;
  name: string;
  area: Area;
  how: string;
  good: string;
  ok: string;
  restricted: string;
  measure?: { label: string; unit: string };
}

export const TESTS: MobilityTestDef[] = [
  { id: "knee_to_wall", name: "Knee to wall", area: "ankle",
    how: "Face a wall in a split stance. Keep the front heel down and push the knee forward to touch the wall. Slide the foot back until you just can't touch. Measure toe to wall. Test both sides; rate the worse one.",
    good: "10 cm or more", ok: "6–9 cm", restricted: "Under 6 cm, or one side much worse", measure: { label: "Worse side", unit: "cm" } },
  { id: "deep_squat", name: "Deep squat hold", area: "hip",
    how: "Feet shoulder-width, toes slightly out. Sit as deep as you can, arms forward, and hold for 30 seconds.",
    good: "Hips below knees, heels down, chest up, comfortable", ok: "Gets there but heels lift or you tip forward", restricted: "Can't get hips to knee height" },
  { id: "hip_90_90", name: "90/90 sit", area: "hip",
    how: "Sit with the front leg bent 90° in front and the back leg bent 90° to the side. Sit tall without hands. Swap sides.",
    good: "Tall and upright both ways, no hands", ok: "Need to lean or use a hand on one side", restricted: "Can't sit in it without both hands" },
  { id: "aslr", name: "Straight-leg raise", area: "hamstring",
    how: "Lie on your back, legs straight. Keep one leg flat and lift the other, straight, as high as you can without bending the knee.",
    good: "Lifted leg passes the other knee (about 70°+)", ok: "Reaches mid-thigh height", restricted: "Below mid-thigh, or the knee bends" },
  { id: "thomas", name: "Knee to chest (hip flexors)", area: "hip_flexor",
    how: "Sit on the edge of a bed, roll back hugging one knee to your chest. Let the other leg hang.",
    good: "Hanging thigh stays flat on the bed, knee bends ~90°", ok: "Thigh lifts slightly or knee straightens a bit", restricted: "Thigh clearly lifts off the bed" },
  { id: "t_rotation", name: "Kneeling upper-back rotation", area: "spine",
    how: "Kneel sitting back on your heels, one hand behind your head. Rotate the elbow up to the ceiling without moving your hips.",
    good: "Shoulders turn 45°+ both ways", ok: "About 30°, or one side tighter", restricted: "Under 30°" },
  { id: "wall_reach", name: "Back-to-wall overhead reach", area: "shoulder",
    how: "Stand with heels, bum and back against a wall, lower back flat. Raise straight arms overhead, thumbs leading, to touch the wall.",
    good: "Thumbs touch the wall, back stays flat", ok: "Touch only by arching the back", restricted: "Can't reach the wall" },
  { id: "wrist_ext", name: "Kneeling wrist extension", area: "wrist",
    how: "On all fours, hands flat under shoulders, fingers forward. Shift your shoulders forward past your hands, keeping palms flat.",
    good: "Shoulders well past the hands, palms flat", ok: "Shoulders just over the hands", restricted: "Palms lift or wrists hurt before you get there" },
];

export interface TestResult { score: 1 | 2 | 3; pain: boolean; value?: number | null }
export interface MobilityTest {
  id: string;
  tested_at: string;
  results: Record<string, TestResult>;
  score: number;
  notes: string | null;
}

/** Area score 0–100 (Restricted 0, OK 50, Good 100; pain caps it at 40) */
export function areaScores(results: Record<string, TestResult>): Partial<Record<Area, number>> {
  const by: Partial<Record<Area, number[]>> = {};
  for (const t of TESTS) {
    const r = results[t.id];
    if (!r) continue;
    let v = ((r.score - 1) / 2) * 100;
    if (r.pain) v = Math.min(v, 40);
    (by[t.area] ??= []).push(v);
  }
  const out: Partial<Record<Area, number>> = {};
  for (const [a, vs] of Object.entries(by)) out[a as Area] = Math.round(vs!.reduce((x, y) => x + y, 0) / vs!.length);
  return out;
}

export function overallScore(results: Record<string, TestResult>): number {
  const v = Object.values(areaScores(results));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
}

// ---------- Drills ----------

export interface Drill {
  id: string;
  name: string;
  area: Area;
  also?: Area[];
  kind: "range" | "control" | "raise";
  level: 1 | 2 | 3;
  sec?: number; // timed
  reps?: number; // counted
  sides?: boolean;
  isStatic?: boolean; // held stretch: daily only, not pre-workout
  pos: "stand" | "kneel" | "floor";
  how: string;
  feel: string;
  avoid?: NiggleArea[]; // left out when one of these niggles is active at level 3+ (any sharp/blocked)
}

export const DRILLS: Drill[] = [
  // Ankle
  { id: "ankle_rocks", name: "Half-kneeling ankle rocks", area: "ankle", kind: "range", level: 1, reps: 10, sides: true, pos: "kneel", how: "Half-kneel, front foot flat. Rock the front knee forward over the little toes, heel down, and back.", feel: "A stretch in the front of the ankle or calf, never a pinch.", avoid: ["knee"] },
  { id: "wall_ankle", name: "Knee-to-wall pulses", area: "ankle", kind: "range", level: 2, reps: 12, sides: true, pos: "stand", how: "Split stance facing a wall at your test distance. Pulse the knee to the wall, heel down.", feel: "Calf and the front of the ankle loosening." },
  { id: "calf_wall", name: "Wall calf stretch, straight then bent knee", area: "ankle", kind: "range", level: 1, sec: 30, sides: true, isStatic: true, pos: "stand", how: "Hands on a wall, one leg back, heel down. 15 s with the knee straight, 15 s bent.", feel: "Upper calf, then lower calf." },
  { id: "slow_calf_raise", name: "Slow single-leg calf raises", area: "ankle", kind: "control", level: 2, reps: 8, sides: true, pos: "stand", how: "Hold a wall for balance. Rise up for 1 s, lower for 3 s, all the way down.", feel: "Calf working through the full range." },
  { id: "squat_ankle_shift", name: "Deep squat ankle shifts", area: "ankle", also: ["hip"], kind: "range", level: 3, reps: 10, pos: "stand", how: "Sit in your deepest squat. Shift your weight slowly over one foot, then the other, knees tracking over toes.", feel: "Ankles and hips opening.", avoid: ["knee", "hip"] },
  // Hip
  { id: "hip_switch", name: "90/90 switches", area: "hip", kind: "range", level: 1, reps: 8, pos: "floor", how: "Sit with knees bent and feet wide. Rotate both knees to one side into 90/90, then the other. Use hands if needed.", feel: "Outer and inner hips taking turns.", avoid: ["knee"] },
  { id: "hip_liftoff", name: "90/90 back-knee lift-offs", area: "hip", kind: "control", level: 3, reps: 5, sides: true, pos: "floor", how: "In 90/90, sit tall and lift the back knee off the floor for 2 s without leaning.", feel: "Deep hip muscles working hard. Cramping is normal.", avoid: ["knee"] },
  { id: "hip_circles", name: "Quadruped hip circles", area: "hip", kind: "control", level: 2, reps: 5, sides: true, pos: "kneel", how: "On all fours, draw the biggest slow circle you can with one knee without moving your spine. 5 each way.", feel: "The hip moving on its own while your back stays still." },
  { id: "frog_rock", name: "Frog rock-backs", area: "hip", kind: "range", level: 1, reps: 10, pos: "kneel", how: "On all fours with knees wide, rock your hips back towards your heels and forward again.", feel: "Inner thighs and groin.", avoid: ["knee"] },
  { id: "squat_pry", name: "Bodyweight deep squat pry", area: "hip", also: ["ankle"], kind: "range", level: 2, sec: 40, pos: "stand", how: "Sit in a deep squat, hands together, elbows pushing knees out. Shift gently side to side.", feel: "Hips and ankles opening.", avoid: ["knee"] },
  { id: "cossack", name: "Cossack squats", area: "hip", also: ["hamstring"], kind: "control", level: 3, reps: 5, sides: true, pos: "stand", how: "Wide stance. Sit down over one leg while the other stays straight with toes up. Push back to the middle.", feel: "Inner thigh of the straight leg and the bent hip.", avoid: ["knee"] },
  { id: "pigeon", name: "Pigeon stretch", area: "hip", kind: "range", level: 2, sec: 40, sides: true, isStatic: true, pos: "floor", how: "From all fours, bring one knee forward and lay the shin across. Back leg straight behind. Sink your hips down.", feel: "Deep in the outer hip and glute of the front leg.", avoid: ["knee"] },
  { id: "glute_bridge", name: "Glute bridges", area: "hip", also: ["core"], kind: "control", level: 1, reps: 12, pos: "floor", how: "On your back, knees bent. Squeeze your glutes and lift your hips until knees, hips and shoulders line up. Pause 1 s.", feel: "Glutes, not lower back or hamstrings." },
  // Hamstring
  { id: "aslr_drill", name: "Active straight-leg raises", area: "hamstring", kind: "control", level: 1, reps: 8, sides: true, pos: "floor", how: "On your back, lift one straight leg as high as you can with no help, lower slowly. Keep the other leg flat.", feel: "Front of the hip lifting, hamstring stretching." },
  { id: "ham_sweep", name: "Hamstring sweeps", area: "hamstring", kind: "range", level: 1, reps: 10, pos: "stand", how: "Heel forward, toes up, front knee soft. Hinge and sweep your hands down past the shin, then step and switch.", feel: "Back of the front leg." },
  { id: "inchworm", name: "Inchworms", area: "hamstring", also: ["shoulder", "core"], kind: "raise", level: 2, reps: 5, pos: "stand", how: "From standing, hands to the floor (bend your knees if needed), walk out to a plank, then walk your feet back to your hands.", feel: "Hamstrings and a whole-body warm-up.", avoid: ["wrist", "lower_back"] },
  { id: "sl_rdl", name: "Single-leg RDL reaches", area: "hamstring", also: ["hip"], kind: "control", level: 2, reps: 6, sides: true, pos: "stand", how: "Stand on one leg, soft knee. Hinge forward, reaching to the floor as the other leg rises behind. Hips square.", feel: "Hamstring and glute of the standing leg." },
  { id: "ham_floss", name: "Lying hamstring flossing", area: "hamstring", kind: "range", level: 1, reps: 10, sides: true, pos: "floor", how: "On your back, hold behind one thigh with the knee bent. Straighten and bend the knee slowly, pointing and flexing the foot.", feel: "A gentle stretch behind the knee. Never tingling.", avoid: ["lower_back"] },
  // Hip flexor
  { id: "hf_kneel", name: "Half-kneeling hip flexor stretch", area: "hip_flexor", kind: "range", level: 1, sec: 30, sides: true, isStatic: true, pos: "kneel", how: "Half-kneel. Squeeze the glute of the back leg and tuck your pelvis under, then shift forward slightly.", feel: "Front of the back hip. Not the lower back.", avoid: ["knee"] },
  { id: "couch", name: "Couch stretch", area: "hip_flexor", kind: "range", level: 3, sec: 40, sides: true, isStatic: true, pos: "kneel", how: "Back knee against a wall or sofa with the shin up it, front foot forward. Squeeze glutes, ribs down, sit tall.", feel: "Strong stretch in the front of the back thigh and hip.", avoid: ["knee", "lower_back"] },
  { id: "wgs", name: "World's greatest stretch", area: "hip_flexor", also: ["spine", "hip"], kind: "range", level: 2, reps: 4, sides: true, pos: "stand", how: "Long lunge, back knee off the floor. Same-side hand down, elbow to instep, then rotate that arm to the ceiling.", feel: "Hip flexor, inner groin and upper back together." },
  { id: "rev_lunge_reach", name: "Reverse lunge with overhead reach", area: "hip_flexor", also: ["shoulder"], kind: "raise", level: 1, reps: 6, sides: true, pos: "stand", how: "Step back into a lunge and reach both arms overhead, leaning slightly away from the back leg. Step back up.", feel: "Front of the back hip and warmth building.", avoid: ["knee"] },
  // Spine
  { id: "cat_cow", name: "Cat-cow", area: "spine", also: ["core"], kind: "range", level: 1, reps: 8, pos: "kneel", how: "On all fours, round your whole back up slowly, then let it sag and look forward. Move one segment at a time.", feel: "Spine moving through its full range, easily." },
  { id: "thread_needle", name: "Thread the needle", area: "spine", also: ["shoulder"], kind: "range", level: 1, reps: 6, sides: true, pos: "kneel", how: "On all fours, slide one arm under your body along the floor, rotating your upper back, then open it to the ceiling.", feel: "Between the shoulder blades and the back of the shoulder." },
  { id: "open_book", name: "Side-lying open books", area: "spine", kind: "range", level: 1, reps: 6, sides: true, pos: "floor", how: "Lie on your side, knees bent up to hip height. Open the top arm across to the other side, following it with your eyes. Knees stay together.", feel: "Chest opening and upper back rotating." },
  { id: "quad_rotation", name: "Quadruped T-spine rotations", area: "spine", kind: "control", level: 2, reps: 8, sides: true, pos: "kneel", how: "On all fours sitting slightly back, hand behind your head. Rotate the elbow down to the opposite wrist, then up to the ceiling.", feel: "Upper back rotating, hips still." },
  { id: "prayer_stretch", name: "Kneeling prayer stretch", area: "spine", also: ["shoulder"], kind: "range", level: 2, sec: 40, isStatic: true, pos: "kneel", how: "Kneel facing a chair or sofa, elbows on it, hands together. Sit back and let your chest sink, bending the elbows so the hands go behind your head.", feel: "Lats and upper back extending.", avoid: ["shoulder"] },
  { id: "sphinx", name: "Sphinx press-ups", area: "spine", also: ["core"], kind: "range", level: 1, reps: 8, pos: "floor", how: "Lie face down on your forearms. Press your chest up gently and lower, keeping hips down.", feel: "A gentle arch through the back. Stop if it pinches.", avoid: ["lower_back"] },
  // Shoulder
  { id: "wall_slides", name: "Wall slides", area: "shoulder", also: ["spine"], kind: "control", level: 1, reps: 10, pos: "stand", how: "Back and arms against a wall in a goalpost shape. Slide the arms up while keeping wrists, elbows and lower back on the wall.", feel: "Mid-back muscles working, shoulders opening." },
  { id: "prone_ytw", name: "Prone Y-T-W raises", area: "shoulder", also: ["spine"], kind: "control", level: 2, reps: 6, pos: "floor", how: "Face down, forehead on a towel. Lift straight arms into a Y, then a T, then a W, squeezing the shoulder blades. That's one rep.", feel: "Upper back and the backs of the shoulders." },
  { id: "shoulder_cars", name: "Shoulder CARs", area: "shoulder", kind: "control", level: 2, reps: 3, sides: true, pos: "stand", how: "Make a fist and squeeze your whole body. Draw the biggest, slowest circle you can with one straight arm. 3 each direction.", feel: "The shoulder moving through every angle it has, under control." },
  { id: "sleeper", name: "Sleeper stretch", area: "shoulder", kind: "range", level: 1, sec: 30, sides: true, isStatic: true, pos: "floor", how: "Lie on your side, bottom arm out at 90° with the elbow bent. Gently press that forearm towards the floor with the other hand.", feel: "Back of the shoulder. Ease off if it's sharp.", avoid: ["shoulder"] },
  { id: "lat_reach", name: "Child's pose side reach", area: "shoulder", also: ["spine"], kind: "range", level: 1, sec: 30, sides: true, isStatic: true, pos: "kneel", how: "In child's pose, walk both hands over to one side and sink your hips back.", feel: "Along the side of your back and under the armpit (lats)." },
  { id: "scap_pushup", name: "Scapular push-ups", area: "shoulder", also: ["core"], kind: "control", level: 1, reps: 10, pos: "kneel", how: "In a plank (or on your knees), arms straight. Let your chest sink between your shoulder blades, then push the floor away.", feel: "Around the shoulder blades.", avoid: ["wrist"] },
  { id: "arm_circles", name: "Arm circles", area: "shoulder", kind: "raise", level: 1, reps: 20, pos: "stand", how: "Arms out to the sides. 10 small-to-big circles forward, 10 backward.", feel: "Shoulders warming up." },
  // Wrist
  { id: "wrist_rocks", name: "Wrist rocks", area: "wrist", kind: "range", level: 1, reps: 10, pos: "kneel", how: "On all fours, palms flat, fingers forward. Rock your shoulders forward over your hands and back.", feel: "Front of the wrists and forearms.", avoid: ["wrist"] },
  { id: "rev_wrist", name: "Reverse-palm wrist stretch", area: "wrist", kind: "range", level: 2, sec: 30, isStatic: true, pos: "kneel", how: "On all fours, turn the hands over so the backs are on the floor and the fingers point to your knees. Sit back gently.", feel: "Backs of the forearms.", avoid: ["wrist", "elbow"] },
  { id: "wrist_cars", name: "Wrist circles", area: "wrist", kind: "control", level: 1, reps: 5, sides: true, pos: "stand", how: "Make a fist, hold that forearm with your other hand, and draw slow full circles. 5 each direction.", feel: "Every angle of the wrist." },
  { id: "forearm_stretch", name: "Standing forearm stretch", area: "wrist", kind: "range", level: 1, sec: 30, sides: true, isStatic: true, pos: "stand", how: "Arm straight in front, palm up. Gently pull the fingers down and back with your other hand, 15 s. Flip the palm down and repeat.", feel: "Inside, then outside of the forearm.", avoid: ["elbow"] },
  // Core / lower back control
  { id: "dead_bug", name: "Dead bugs", area: "core", kind: "control", level: 1, reps: 8, sides: true, pos: "floor", how: "On your back, arms up, knees over hips. Press your lower back to the floor. Lower the opposite arm and leg slowly and return.", feel: "Deep abs holding your back flat." },
  { id: "bird_dog", name: "Bird dogs", area: "core", also: ["hip"], kind: "control", level: 1, reps: 6, sides: true, pos: "kneel", how: "On all fours, reach the opposite arm and leg out long. Hold 2 s without your hips tipping.", feel: "Glute and trunk keeping you steady." },
  { id: "side_plank", name: "Side plank", area: "core", kind: "control", level: 2, sec: 20, sides: true, pos: "floor", how: "On your forearm and the side of your knees (easier) or feet. Body in a straight line, hips up.", feel: "Side of the trunk and hip.", avoid: ["shoulder"] },
  { id: "curl_up", name: "McGill curl-ups", area: "core", kind: "control", level: 1, reps: 5, pos: "floor", how: "On your back, one knee bent, hands under your lower back. Lift your head and shoulders a few centimetres and hold 8 s.", feel: "Abs working without your back moving." },
  // Neck
  { id: "chin_tuck", name: "Chin tucks", area: "neck", kind: "control", level: 1, reps: 10, pos: "stand", how: "Stand tall. Glide your chin straight back (a double chin) without tipping your head, hold 2 s.", feel: "Back of the neck lengthening." },
  { id: "neck_cars", name: "Slow neck circles", area: "neck", kind: "range", level: 1, reps: 3, pos: "stand", how: "Very slowly roll your head through a comfortable range, 3 each way. Never force the backward part.", feel: "Easy movement. No dizziness or tingling.", avoid: ["neck"] },
  { id: "trap_stretch", name: "Upper trap stretch", area: "neck", also: ["shoulder"], kind: "range", level: 1, sec: 30, sides: true, isStatic: true, pos: "stand", how: "Sit on one hand. Tilt your ear to the other shoulder and gently assist with the free hand.", feel: "Side of the neck and top of the shoulder." },
  // Raise (pre-workout)
  { id: "step_jacks", name: "Step jacks", area: "core", kind: "raise", level: 1, sec: 40, pos: "stand", how: "Step one foot out to the side as the arms go overhead, back in, then the other side. Speed up as you warm.", feel: "Heart rate and breathing coming up." },
  { id: "bw_squat", name: "Bodyweight squats", area: "hip", also: ["ankle"], kind: "raise", level: 1, reps: 12, pos: "stand", how: "Feet shoulder-width. Squat smoothly to a comfortable depth, standing tall at the top.", feel: "Legs warming, hips and ankles moving.", avoid: ["knee"] },
  { id: "march", name: "High-knee march", area: "hip_flexor", kind: "raise", level: 1, sec: 30, pos: "stand", how: "March on the spot, knees to hip height, arms driving.", feel: "Hips and heart rate warming." },
];

export const DRILL_BY_ID = new Map(DRILLS.map((d) => [d.id, d]));

/** Estimated seconds a drill takes, including a short transition */
export function drillSeconds(d: Drill): number {
  const per = d.sec ?? (d.reps ?? 8) * 3.5;
  return Math.round(per * (d.sides ? 2 : 1) + 8);
}

// ---------- Priorities ----------

export interface MobilitySession {
  id: string;
  done_at: string;
  kind: "daily" | "prewarm";
  template_id: string | null;
  duration_sec: number;
  drills: { id: string; area: Area; level: number }[];
  feedback: Partial<Record<Area, "better" | "same" | "worse">>;
}

export interface Ctx {
  test: MobilityTest | null;
  niggles: Niggle[]; // active only
  sessions: MobilitySession[]; // newest first
}

export interface AreaState {
  area: Area;
  priority: number;
  level: 1 | 2 | 3;
  blocked: boolean;
  reasons: string[];
  painful: boolean;
}

const MUSCLE_AREAS: Record<Muscle, Area[]> = {
  chest: ["shoulder", "spine", "wrist"], back: ["spine", "shoulder"], shoulders: ["shoulder", "spine", "wrist"],
  biceps: ["wrist", "shoulder"], triceps: ["shoulder", "wrist"], quads: ["ankle", "hip", "hip_flexor"],
  hamstrings: ["hamstring", "hip"], glutes: ["hip", "hip_flexor"], calves: ["ankle"], core: ["core"],
  full_body: ["hip", "spine", "ankle"], other: [],
};

/** How much a template loads each area (sum over its exercises, first-listed areas weighted most) */
export function templateDemand(t: Template | null, exercises: Exercise[]): Partial<Record<Area, number>> {
  const out: Partial<Record<Area, number>> = {};
  if (!t) return out;
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  t.exercises.forEach((te, i) => {
    const ex = exMap.get(te.exercise_id);
    if (!ex) return;
    const w = i < 2 ? 1.5 : 1; // main lifts first
    MUSCLE_AREAS[ex.muscle].forEach((a, j) => {
      out[a] = (out[a] ?? 0) + w * (j === 0 ? 1 : 0.6);
    });
    if (ex.equipment === "barbell" && (ex.muscle === "quads" || ex.muscle === "back")) out.spine = (out.spine ?? 0) + 0.5;
  });
  return out;
}

export function areaStates(ctx: Ctx, demand: Partial<Record<Area, number>> = {}): AreaState[] {
  const scores = ctx.test ? areaScores(ctx.test.results) : {};
  const states: AreaState[] = AREAS.map((area) => {
    const s = scores[area];
    let priority = 1;
    let level: number = 2;
    const reasons: string[] = [];
    let painful = false;
    if (s != null) {
      if (s < 34) { priority += 3; level = 1; reasons.push("restricted on your screen"); }
      else if (s < 67) { priority += 1.5; level = 2; reasons.push("OK on your screen"); }
      else { priority += 0; level = 2; }
      const t = TESTS.find((x) => x.area === area);
      if (t && ctx.test?.results[t.id]?.pain) { painful = true; level = 1; reasons.push("hurt during the test"); }
    } else if (area !== "core" && area !== "neck") {
      level = 1;
    }
    // Feedback: recent sessions that worked this area
    const recent = ctx.sessions.filter((x) => x.drills.some((d) => d.area === area)).slice(0, 4);
    const fb = recent.map((x) => x.feedback[area]).filter(Boolean) as string[];
    if (fb[0] === "worse") { level -= 1; priority += 0.5; reasons.push("felt worse last time, so drills are easier"); }
    else if (fb.slice(0, 2).length === 2 && fb.slice(0, 2).every((f) => f === "better")) { level += 1; priority -= 1; reasons.push("improving, so drills step up"); }
    // Niggles
    let blocked = false;
    for (const n of ctx.niggles) {
      const m = NIGGLE_MAP[n.area];
      const rest = m.rest.includes(area);
      if (!rest && !m.near.includes(area)) continue;
      const what = NIGGLE_LABEL[n.area].toLowerCase();
      if (isBlocked(n)) {
        if (rest) { blocked = true; reasons.push(`${what} niggle is ${n.kind === "sharp" ? "sharp" : n.red_flag ? "flagged" : "strong"}, so it's rested`); }
        else { level = 1; reasons.push(`gentle only, around your ${what}`); }
      } else {
        priority += n.level * (rest ? 0.7 : 0.35);
        if (n.level >= 3) level = 1;
        reasons.push(`${n.kind} ${what} (${n.level}/5)`);
      }
    }
    const d = demand[area] ?? 0;
    if (d > 0) { priority += Math.min(2, d * 0.6); reasons.push("used in your next workout"); }
    if (painful && !blocked) priority += 0.5;
    return { area, priority, level: Math.max(1, Math.min(3, level)) as 1 | 2 | 3, blocked, reasons, painful };
  });
  return states.sort((a, b) => b.priority - a.priority);
}

function blockedNiggleAreas(niggles: Niggle[]): Set<NiggleArea> {
  // Drills that list a niggle area under `avoid` are skipped when that niggle is level 3+ or blocked
  return new Set(niggles.filter((n) => isBlocked(n) || n.level >= 3).map((n) => n.area));
}

const dayIndex = (d = new Date()) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);

function pick(cands: Drill[], level: number, seed: number, used: Set<string>): Drill | null {
  const free = cands.filter((d) => !used.has(d.id));
  if (!free.length) return null;
  const at = free.filter((d) => d.level === level);
  const below = free.filter((d) => d.level < level).sort((a, b) => b.level - a.level);
  const pool = at.length ? at : below.length ? below.filter((d) => d.level === below[0].level) : free.filter((d) => d.level === Math.min(...free.map((x) => x.level)));
  return pool[seed % pool.length];
}

export interface RoutineItem { drill: Drill; area: Area; phase?: "raise" | "mobilise" }
export interface Routine {
  kind: "daily" | "prewarm";
  items: RoutineItem[];
  seconds: number;
  focus: AreaState[];
  rested: AreaState[];
  note: string | null;
}

// Floor first, finish standing
const POS_ORDER = { floor: 0, kneel: 1, stand: 2 };

/** ~10-minute daily routine */
export function dailyRoutine(ctx: Ctx, demand: Partial<Record<Area, number>> = {}, target = 600, date = new Date()): Routine {
  const seed = dayIndex(date);
  // Equal priorities rotate day to day so untested areas still get covered
  const jitter = (a: Area) => ((AREAS.indexOf(a) * 7 + seed) % AREAS.length) * 0.04;
  const states = areaStates(ctx, demand).sort((a, b) => b.priority + jitter(b.area) - (a.priority + jitter(a.area)));
  const avoid = blockedNiggleAreas(ctx.niggles);
  const ok = (d: Drill) => d.kind !== "raise" && !(d.avoid ?? []).some((a) => avoid.has(a));
  const open = states.filter((s) => !s.blocked);
  const used = new Set<string>();
  const items: RoutineItem[] = [];
  let seconds = 0;
  // Round 1: top 4 areas get a range drill; round 2: the top 2 add a control drill; then fill with the next areas
  const plan: { s: AreaState; kind: "range" | "control" | "any" }[] = [];
  open.slice(0, 4).forEach((s) => plan.push({ s, kind: "range" }));
  open.slice(0, 2).forEach((s) => plan.push({ s, kind: "control" }));
  open.slice(4).forEach((s) => plan.push({ s, kind: "any" }));
  open.slice(2, 4).forEach((s) => plan.push({ s, kind: "control" }));
  for (const [i, p] of plan.entries()) {
    if (seconds >= target - 30) break;
    const cands = DRILLS.filter((d) => ok(d) && (d.area === p.s.area) && (p.kind === "any" || d.kind === p.kind || (p.kind === "range" && d.kind === "control" && p.s.painful)));
    // Painful areas: gentle range only (no static end-range holds)
    const safe = p.s.painful ? cands.filter((d) => !d.isStatic && d.level === 1) : cands;
    const d = pick(safe.length ? safe : cands, p.s.level, seed + i, used);
    if (!d) continue;
    const t = drillSeconds(d);
    if (seconds + t > target + 45) continue;
    used.add(d.id);
    items.push({ drill: d, area: p.s.area });
    seconds += t;
  }
  // Top up to ~10 minutes with more drills for the open areas, highest priority first
  for (let pass = 0; pass < 3 && seconds < target - 40; pass++) {
    for (const [i, s] of open.entries()) {
      if (seconds >= target - 40) break;
      const cands = DRILLS.filter((d) => ok(d) && d.area === s.area && d.level <= Math.max(s.level, pass + 1) && !(s.painful && d.isStatic));
      const d = pick(cands, s.level, seed + i + pass * 3, used);
      if (!d) continue;
      const t = drillSeconds(d);
      if (seconds + t > target + 45) continue;
      used.add(d.id);
      items.push({ drill: d, area: s.area });
      seconds += t;
    }
  }
  items.sort((a, b) => POS_ORDER[a.drill.pos] - POS_ORDER[b.drill.pos]);
  const rested = states.filter((s) => s.blocked);
  return {
    kind: "daily", items, seconds, focus: open.filter((s) => items.some((it) => it.area === s.area)).slice(0, 5), rested,
    note: rested.length ? "Some areas are being rested because of a sharp, strong or flagged niggle. If it hasn't settled in a week or two, see a physio." : null,
  };
}

/** ~5-minute pre-workout warm-up (RAMP: raise, then activate & mobilise what the template loads) */
export function preWorkout(ctx: Ctx, t: Template, exercises: Exercise[], target = 300): Routine {
  const demand = templateDemand(t, exercises);
  const states = areaStates(ctx, demand);
  const avoid = blockedNiggleAreas(ctx.niggles);
  const ok = (d: Drill) => !d.isStatic && !(d.avoid ?? []).some((a) => avoid.has(a));
  const lower = (demand.hip ?? 0) + (demand.ankle ?? 0) + (demand.hamstring ?? 0) >= (demand.shoulder ?? 0) + (demand.spine ?? 0);
  const items: RoutineItem[] = [];
  const used = new Set<string>();
  let seconds = 0;
  // Raise (~60 s)
  const raiseIds = lower ? ["step_jacks", "bw_squat"] : ["step_jacks", "arm_circles"];
  for (const id of raiseIds) {
    const d = DRILL_BY_ID.get(id)!;
    if (!ok(d)) continue;
    used.add(id);
    items.push({ drill: d, area: d.area, phase: "raise" });
    seconds += drillSeconds(d);
  }
  // Activate & mobilise: areas the workout uses, most-needed first
  const targets = states.filter((s) => !s.blocked && (demand[s.area] ?? 0) > 0).sort((a, b) => (demand[b.area]! * 2 + b.priority) - (demand[a.area]! * 2 + a.priority));
  const seed = dayIndex();
  let round = 0;
  while (seconds < target - 25 && round < 3) {
    for (const [i, s] of targets.entries()) {
      if (seconds >= target - 25) break;
      const want = round === 0 ? "range" : "control";
      const cands = DRILLS.filter((d) => ok(d) && d.kind !== "raise" && (d.area === s.area || (d.also ?? []).includes(s.area)) && (round > 1 || d.kind === want));
      const d = pick(cands, Math.min(s.level, 2), seed + i + round, used);
      if (!d) continue;
      const tt = drillSeconds(d);
      if (seconds + tt > target + 30) continue;
      used.add(d.id);
      items.push({ drill: d, area: s.area, phase: "mobilise" });
      seconds += tt;
    }
    round++;
  }
  const rested = states.filter((s) => s.blocked && (demand[s.area] ?? 0) > 0);
  return {
    kind: "prewarm", items, seconds, focus: targets.slice(0, 4), rested,
    note: rested.length ? `${rested.map((r) => AREA_LABEL[r.area]).join(", ")} rested because of a niggle; go lighter on lifts that load it, or skip them.` : null,
  };
}

export function needsRetest(test: MobilityTest | null): boolean {
  return !test || Date.now() - new Date(test.tested_at).getTime() > 28 * 86400000;
}

export function activeNiggles(niggles: Niggle[]): Niggle[] {
  return niggles.filter((n) => !n.resolved_at);
}

export function mobilityCtx(d: { mobilityTests: MobilityTest[]; niggles: Niggle[]; mobilitySessions: MobilitySession[] }): Ctx {
  return { test: d.mobilityTests[0] ?? null, niggles: activeNiggles(d.niggles), sessions: d.mobilitySessions };
}

export function doseText(d: Drill): string {
  const base = d.sec ? `${d.sec} s` : `${d.reps} reps`;
  return d.sides ? `${base} each side` : base;
}

export const fmtMin = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`;

export function doneToday(sessions: MobilitySession[], kind: "daily" | "prewarm" = "daily"): MobilitySession | null {
  const t = new Date();
  return sessions.find((s) => s.kind === kind && new Date(s.done_at).toDateString() === t.toDateString()) ?? null;
}

/** Days with any mobility session in the last 7 days */
export function daysThisWeek(sessions: MobilitySession[]): number {
  const cut = Date.now() - 7 * 86400000;
  return new Set(sessions.filter((s) => new Date(s.done_at).getTime() >= cut).map((s) => new Date(s.done_at).toDateString())).size;
}

export const SCORE_LABEL = (s: number) => (s >= 80 ? "Good" : s >= 55 ? "OK" : "Restricted");
