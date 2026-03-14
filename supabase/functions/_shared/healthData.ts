// Shared health data gathering for edge functions
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

export interface HealthData {
  daily_summaries: unknown[];
  sleep: unknown[];
  hrv: unknown[];
  activities: unknown[];
  cv_exercise_log: { date: string; exercise: string; total_reps: number }[];
  body_composition: unknown | null;
  today_snapshot: {
    sleep_score: number | null;
    body_battery: number | null;
    hrv_status: string | null;
    hrv_value: number | null;
    stress_avg: number | null;
  };
  preferences: Record<string, unknown>;
}

export async function gatherHealthData(
  serviceClient: SupabaseClient,
  userId: string,
  preferences: Record<string, unknown> = {},
): Promise<HealthData> {
  const since7 = daysAgo(7);
  const since14 = daysAgo(14);

  const [
    { data: dailySummaries },
    { data: sleepData },
    { data: hrvData },
    { data: activities },
    { data: workoutEntries },
    { data: bodyComp },
    { data: dailyExtended },
  ] = await Promise.all([
    serviceClient
      .from("daily_summaries")
      .select("date, steps, calories_active, stress_avg, stress_max, intensity_minutes, resting_heart_rate")
      .eq("user_id", userId)
      .gte("date", since7)
      .order("date", { ascending: true }),
    serviceClient
      .from("sleep_summaries")
      .select("date, sleep_score, total_sleep_seconds, deep_seconds, rem_seconds, awake_seconds")
      .eq("user_id", userId)
      .gte("date", since7)
      .order("date", { ascending: true }),
    serviceClient
      .from("hrv_summaries")
      .select("date, last_night_avg, weekly_avg, baseline_low, baseline_upper, status")
      .eq("user_id", userId)
      .gte("date", since7)
      .order("date", { ascending: true }),
    serviceClient
      .from("activities")
      .select("date, activity_type, name, duration_seconds, distance_meters, calories, avg_heart_rate, max_heart_rate")
      .eq("user_id", userId)
      .gte("date", since14)
      .order("date", { ascending: false })
      .limit(20),
    serviceClient
      .from("workout_entries")
      .select("exercise, reps, performed_at")
      .eq("user_id", userId)
      .gte("performed_at", since7 + "T00:00:00Z")
      .order("performed_at", { ascending: true }),
    serviceClient
      .from("body_composition")
      .select("date, weight_kg, body_fat_pct, muscle_mass_kg, bmi")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(1),
    serviceClient
      .from("daily_summary_extended")
      .select("date, steps, calories_active, stress_avg, intensity_minutes, resting_heart_rate, bb_current, bb_high, bb_low, bb_charged, bb_drained, rest_stress_duration, low_stress_duration, medium_stress_duration, high_stress_duration")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(1),
  ]);

  // Build today's snapshot
  const latestDaily = dailyExtended?.[0] || {};
  const latestSleep = sleepData?.length ? sleepData[sleepData.length - 1] : {};
  const latestHrv = hrvData?.length ? hrvData[hrvData.length - 1] : {};

  const todaySnapshot = {
    sleep_score: (latestSleep as Record<string, unknown>).sleep_score as number ?? null,
    body_battery: (latestDaily as Record<string, unknown>).bb_current as number ?? null,
    hrv_status: (latestHrv as Record<string, unknown>).status as string ?? null,
    hrv_value: (latestHrv as Record<string, unknown>).last_night_avg as number ?? null,
    stress_avg: (latestDaily as Record<string, unknown>).stress_avg as number ?? null,
  };

  // Aggregate uTrain workout entries by date+exercise
  const workoutAgg: Record<string, Record<string, number>> = {};
  for (const e of workoutEntries || []) {
    const d = (e as Record<string, unknown>).performed_at
      ? new Date(e.performed_at as string).toISOString().split("T")[0]
      : "unknown";
    const ex = (e as Record<string, unknown>).exercise as string;
    if (!workoutAgg[d]) workoutAgg[d] = {};
    workoutAgg[d][ex] = (workoutAgg[d][ex] || 0) + ((e as Record<string, unknown>).reps as number || 0);
  }
  const cvLog = Object.entries(workoutAgg).flatMap(([date, exercises]) =>
    Object.entries(exercises).map(([exercise, total_reps]) => ({ date, exercise, total_reps }))
  );

  return {
    daily_summaries: dailySummaries || [],
    sleep: sleepData || [],
    hrv: hrvData || [],
    activities: activities || [],
    cv_exercise_log: cvLog,
    body_composition: bodyComp?.[0] || null,
    today_snapshot: todaySnapshot,
    preferences,
  };
}

export function formatHealthDataForPrompt(healthData: HealthData): string {
  return `## Client Health Data — Past 7 Days

### Daily Summaries
${JSON.stringify(healthData.daily_summaries, null, 2)}

### Sleep
${JSON.stringify(healthData.sleep, null, 2)}

### HRV
${JSON.stringify(healthData.hrv, null, 2)}

### Activities (14 days)
${JSON.stringify(healthData.activities, null, 2)}

### uTrain Exercise Log (7 days)
${JSON.stringify(healthData.cv_exercise_log, null, 2)}

### Body Composition (latest)
${JSON.stringify(healthData.body_composition, null, 2)}

### Today's Snapshot
${JSON.stringify(healthData.today_snapshot, null, 2)}

### Client Preferences
${JSON.stringify(healthData.preferences, null, 2)}`;
}

export async function hashData(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
