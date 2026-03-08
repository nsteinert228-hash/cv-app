import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 2048;

// ── Prompt templates ─────────────────────────────────────────

const SYSTEM_PROMPT = `You are an elite personal trainer and sports scientist analyzing a client's wearable health data and exercise history. You provide evidence-based, personalized training recommendations.

Rules:
- Respond ONLY with valid JSON matching the requested schema — no markdown fences, no commentary outside JSON
- Base all recommendations on the actual data provided — never invent metrics
- Recovery indicators (HRV trend, sleep score, body battery, stress) are PRIMARY decision factors
- Flag concerning patterns: declining HRV, poor sleep streaks, elevated resting HR, overtraining signs
- Adjust intensity based on readiness: low readiness → recovery/easy day, high → push harder
- Account for recent training volume and type to balance load across the week
- If data is sparse or missing, note it and provide conservative recommendations
- Include the CV exercise data (squats, pushups, lunges) as bodyweight training context
- Be specific with exercises — include sets, reps, rest times, and form cues where relevant`;

const VIEW_SCHEMAS: Record<string, string> = {
  today: `{
  "view": "today",
  "date": "YYYY-MM-DD",
  "readiness_assessment": {
    "level": "high" | "moderate" | "low",
    "summary": "1-2 sentence readiness assessment",
    "key_factors": ["e.g. 'HRV trending up', 'Poor sleep last night'"]
  },
  "recommendation": {
    "type": "strength" | "cardio" | "recovery" | "mixed" | "rest",
    "title": "e.g. Upper Body Strength + Light Cardio",
    "intensity": "high" | "moderate" | "low" | "rest",
    "duration_minutes": 45,
    "description": "2-3 sentence overview",
    "warmup": { "duration_minutes": 5, "activities": ["string"] },
    "main_workout": [
      {
        "exercise": "string",
        "sets": 3,
        "reps": "8-12 or 30 seconds or 1 mile",
        "rest_seconds": 60,
        "notes": "optional form cues or modifications"
      }
    ],
    "cooldown": { "duration_minutes": 5, "activities": ["string"] }
  },
  "alerts": [{ "type": "warning" | "info" | "positive", "message": "string" }],
  "nutrition_tip": "optional recovery/fueling suggestion"
}`,
  week: `{
  "view": "week",
  "generated_for_week": "YYYY-MM-DD to YYYY-MM-DD",
  "weekly_summary": "overview of the week's training strategy",
  "training_load_assessment": {
    "recent_load": "high" | "moderate" | "low",
    "trend": "increasing" | "stable" | "decreasing",
    "recommendation": "string"
  },
  "days": [
    {
      "date": "YYYY-MM-DD",
      "day_name": "Monday",
      "type": "strength" | "cardio" | "recovery" | "mixed" | "rest",
      "title": "string",
      "intensity": "high" | "moderate" | "low" | "rest",
      "duration_minutes": 45,
      "focus": "brief description",
      "is_today": true | false
    }
  ],
  "weekly_goals": [{ "metric": "e.g. Total active minutes", "target": "string" }],
  "alerts": [{ "type": "warning" | "info" | "positive", "message": "string" }]
}`,
  plan: `{
  "view": "plan",
  "plan_name": "e.g. 4-Week General Fitness Build",
  "plan_summary": "2-3 sentence overview",
  "current_assessment": {
    "fitness_level": "beginner" | "intermediate" | "advanced",
    "strengths": ["string"],
    "areas_to_improve": ["string"],
    "training_age_estimate": "string"
  },
  "phases": [
    {
      "week": 1,
      "name": "e.g. Foundation",
      "focus": "string",
      "intensity_range": "e.g. Moderate",
      "sessions_per_week": 4,
      "key_workouts": ["brief descriptions"]
    }
  ],
  "principles": ["e.g. Progressive overload on compound movements"],
  "milestones": [{ "timeframe": "string", "goal": "string" }]
}`,
};

// ── Helpers ───────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

async function hashData(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Main handler ─────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing authorization" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await anonClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    // ── Parse request ──
    const body = await req.json();
    const view = body.view as string;
    if (!view || !VIEW_SCHEMAS[view]) {
      return jsonResponse({ error: "Invalid view. Must be: today, week, or plan" }, 400);
    }
    const preferences = body.preferences || {};
    const force = body.force === true;

    // ── Service role client for data queries ──
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Gather health data ──
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
        .eq("user_id", user.id)
        .gte("date", since7)
        .order("date", { ascending: true }),
      serviceClient
        .from("sleep_summaries")
        .select("date, sleep_score, total_sleep_seconds, deep_seconds, rem_seconds, awake_seconds")
        .eq("user_id", user.id)
        .gte("date", since7)
        .order("date", { ascending: true }),
      serviceClient
        .from("hrv_summaries")
        .select("date, last_night_avg, weekly_avg, baseline_low, baseline_upper, status")
        .eq("user_id", user.id)
        .gte("date", since7)
        .order("date", { ascending: true }),
      serviceClient
        .from("activities")
        .select("date, activity_type, name, duration_seconds, distance_meters, calories, avg_heart_rate, max_heart_rate")
        .eq("user_id", user.id)
        .gte("date", since14)
        .order("date", { ascending: false })
        .limit(20),
      serviceClient
        .from("workout_entries")
        .select("exercise, reps, performed_at")
        .eq("user_id", user.id)
        .gte("performed_at", since7 + "T00:00:00Z")
        .order("performed_at", { ascending: true }),
      serviceClient
        .from("body_composition")
        .select("date, weight_kg, body_fat_pct, muscle_mass_kg, bmi")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(1),
      serviceClient
        .from("daily_summary_extended")
        .select("date, steps, calories_active, stress_avg, intensity_minutes, resting_heart_rate, bb_current, bb_high, bb_low, bb_charged, bb_drained, rest_stress_duration, low_stress_duration, medium_stress_duration, high_stress_duration")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(1),
    ]);

    // ── Build today's snapshot ──
    const latestDaily = dailyExtended?.[0] || {};
    const latestSleep = sleepData?.length ? sleepData[sleepData.length - 1] : {};
    const latestHrv = hrvData?.length ? hrvData[hrvData.length - 1] : {};

    const todaySnapshot = {
      sleep_score: (latestSleep as Record<string, unknown>).sleep_score ?? null,
      body_battery: (latestDaily as Record<string, unknown>).bb_current ?? null,
      hrv_status: (latestHrv as Record<string, unknown>).status ?? null,
      hrv_value: (latestHrv as Record<string, unknown>).last_night_avg ?? null,
      stress_avg: (latestDaily as Record<string, unknown>).stress_avg ?? null,
    };

    // ── Aggregate CV workout entries by date+exercise ──
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

    // ── Build data payload for hashing + prompt ──
    const healthData = {
      daily_summaries: dailySummaries || [],
      sleep: sleepData || [],
      hrv: hrvData || [],
      activities: activities || [],
      cv_exercise_log: cvLog,
      body_composition: bodyComp?.[0] || null,
      today_snapshot: todaySnapshot,
      preferences,
    };

    const dataStr = JSON.stringify(healthData);
    const dataHash = await hashData(dataStr);

    // ── Check cache ──
    if (!force) {
      const today = new Date().toISOString().split("T")[0];
      const { data: cached } = await serviceClient
        .from("training_recommendations_cache")
        .select("response_json, created_at")
        .eq("user_id", user.id)
        .eq("view", view)
        .eq("data_hash", dataHash)
        .gte("created_at", today + "T00:00:00Z")
        .order("created_at", { ascending: false })
        .limit(1);

      if (cached && cached.length > 0) {
        return jsonResponse({
          ...cached[0].response_json,
          _cached: true,
          _generated_at: cached[0].created_at,
        });
      }
    }

    // ── Build Claude prompt ──
    const userMessage = `## Client Health Data — Past 7 Days

### Daily Summaries
${JSON.stringify(healthData.daily_summaries, null, 2)}

### Sleep
${JSON.stringify(healthData.sleep, null, 2)}

### HRV
${JSON.stringify(healthData.hrv, null, 2)}

### Activities (14 days)
${JSON.stringify(healthData.activities, null, 2)}

### CV Exercise Log (7 days)
${JSON.stringify(healthData.cv_exercise_log, null, 2)}

### Body Composition (latest)
${JSON.stringify(healthData.body_composition, null, 2)}

### Today's Snapshot
${JSON.stringify(healthData.today_snapshot, null, 2)}

### Client Preferences
${JSON.stringify(healthData.preferences, null, 2)}

---

Today's date is ${new Date().toISOString().split("T")[0]}.

Provide a "${view}" recommendation as JSON matching this schema:
${VIEW_SCHEMAS[view]}`;

    // ── Call Claude API ──
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      console.error("Claude API error:", claudeRes.status, errBody);
      return jsonResponse({ error: "AI service temporarily unavailable" }, 502);
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "";

    // ── Parse JSON from response ──
    let recommendation: unknown;
    try {
      // Try direct parse first, then extract from markdown fences
      const cleaned = rawText.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      recommendation = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse Claude response:", rawText.substring(0, 500));
      return jsonResponse({ error: "Failed to parse AI recommendation" }, 502);
    }

    // ── Cache the response ──
    await serviceClient.from("training_recommendations_cache").insert({
      user_id: user.id,
      view,
      data_hash: dataHash,
      response_json: recommendation,
    });

    return jsonResponse({
      ...(recommendation as Record<string, unknown>),
      _cached: false,
      _generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("training-recommendations error:", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
