import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { gatherHealthData, formatHealthDataForPrompt } from "../_shared/healthData.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 8192;
const DEFAULT_DURATION_WEEKS = 8;

// ── Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an elite personal trainer and sports scientist creating a comprehensive, personalized training season plan.

Rules:
- Respond ONLY with valid JSON matching the requested schema — no markdown fences, no commentary
- Base the plan on actual health data provided — never invent metrics
- Recovery indicators (HRV trend, sleep score, body battery, stress) guide intensity planning
- Account for the client's stated goals, experience level, and any injuries
- Build a progressive, periodized plan with appropriate volume and intensity ramps
- Include a mix of strength, cardio, recovery, and rest days
- Each daily workout must have specific exercises with sets, reps, rest times, and form cues
- Cardio workouts should specify type (running, cycling, swimming), duration, and intensity zone
- Rest and recovery days should include active recovery suggestions
- If previous season data is provided, build on it — progress from where they left off`;

const SEASON_SCHEMA = `{
  "plan": {
    "name": "e.g. 8-Week Strength Foundation",
    "summary": "2-3 sentence overview of the season goals and approach",
    "phases": [
      {
        "weeks": [1, 2],
        "name": "e.g. Foundation",
        "focus": "string",
        "intensity_range": "e.g. Low to Moderate"
      }
    ],
    "principles": ["e.g. Progressive overload on compound movements"],
    "milestones": [{ "timeframe": "Week 4", "goal": "string" }],
    "current_assessment": {
      "fitness_level": "beginner | intermediate | advanced",
      "strengths": ["string"],
      "areas_to_improve": ["string"],
      "training_age_estimate": "string"
    }
  },
  "daily_workouts": [
    {
      "day_offset": 0,
      "week_number": 1,
      "day_of_week": 1,
      "workout_type": "strength | cardio | recovery | mixed | rest",
      "title": "e.g. Upper Body Strength",
      "intensity": "high | moderate | low | rest",
      "duration_minutes": 45,
      "prescription": {
        "description": "2-3 sentence overview",
        "warmup": { "duration_minutes": 5, "activities": ["string"] },
        "main_workout": [
          {
            "exercise": "string",
            "sets": 3,
            "reps": "8-12 or 30 min or 2 miles",
            "rest_seconds": 60,
            "notes": "form cues or zone target"
          }
        ],
        "cooldown": { "duration_minutes": 5, "activities": ["string"] }
      }
    }
  ]
}

IMPORTANT: daily_workouts must contain exactly {TOTAL_DAYS} entries, one for each day of the season, ordered by day_offset (0 to {LAST_DAY}). day_of_week uses 1=Monday through 7=Sunday.`;

// ── Helpers ─────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getStartDate(): Date {
  const now = new Date();
  // Start on next Monday if today is not Monday
  const day = now.getDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + daysUntilMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// ── Main handler ────────────────────────────────────────────

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
    const preferences = body.preferences || {};
    const previousSeasonId = body.previous_season_id || null;
    const durationWeeks = body.duration_weeks || DEFAULT_DURATION_WEEKS;

    // ── Service client ──
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Check for existing active season ──
    const { data: activeSeason } = await serviceClient
      .from("training_seasons")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (activeSeason) {
      return jsonResponse({ error: "An active season already exists", season_id: activeSeason.id }, 409);
    }

    // ── Get season number ──
    const { count } = await serviceClient
      .from("training_seasons")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    const seasonNumber = (count || 0) + 1;

    // ── Fetch previous season summary if provided ──
    let previousSeasonSummary = null;
    if (previousSeasonId) {
      const { data: prevSeason } = await serviceClient
        .from("training_seasons")
        .select("name, plan_json, completion_summary, duration_weeks")
        .eq("id", previousSeasonId)
        .eq("user_id", user.id)
        .single();

      if (prevSeason) {
        previousSeasonSummary = {
          name: prevSeason.name,
          duration_weeks: prevSeason.duration_weeks,
          completion_summary: prevSeason.completion_summary,
        };
      }
    }

    // ── Gather health data ──
    const healthData = await gatherHealthData(serviceClient, user.id, preferences);
    const healthPrompt = formatHealthDataForPrompt(healthData);

    // ── Build Claude prompt ──
    const totalDays = durationWeeks * 7;
    const schema = SEASON_SCHEMA
      .replace("{TOTAL_DAYS}", String(totalDays))
      .replace("{LAST_DAY}", String(totalDays - 1));

    let userMessage = `${healthPrompt}

---

Today's date is ${formatDate(new Date())}.
Create a ${durationWeeks}-week training season plan (${totalDays} days total).

Respond as JSON matching this schema:
${schema}`;

    if (previousSeasonSummary) {
      userMessage += `

### Previous Season Context
${JSON.stringify(previousSeasonSummary, null, 2)}

Build on the previous season — progress from where the client left off.`;
    }

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

    // ── Parse response ──
    let parsed: { plan: Record<string, unknown>; daily_workouts: Record<string, unknown>[] };
    try {
      const cleaned = rawText.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse season plan:", rawText.substring(0, 500));
      return jsonResponse({ error: "Failed to parse AI-generated plan" }, 502);
    }

    if (!parsed.plan || !parsed.daily_workouts || !Array.isArray(parsed.daily_workouts)) {
      return jsonResponse({ error: "Invalid plan structure from AI" }, 502);
    }

    // ── Compute dates ──
    const startDate = getStartDate();
    const endDate = addDays(startDate, totalDays - 1);

    // ── Insert season ──
    const { data: season, error: seasonError } = await serviceClient
      .from("training_seasons")
      .insert({
        user_id: user.id,
        season_number: seasonNumber,
        name: (parsed.plan as Record<string, unknown>).name || `Season ${seasonNumber}`,
        status: "active",
        duration_weeks: durationWeeks,
        start_date: formatDate(startDate),
        end_date: formatDate(endDate),
        plan_json: parsed.plan,
        preferences_snapshot: preferences,
        previous_season_id: previousSeasonId,
        previous_season_summary: previousSeasonSummary,
      })
      .select("id")
      .single();

    if (seasonError) {
      console.error("Season insert error:", seasonError);
      return jsonResponse({ error: "Failed to save season" }, 500);
    }

    // ── Insert daily workouts ──
    const workoutRows = parsed.daily_workouts.map((w: Record<string, unknown>) => {
      const dayOffset = (w.day_offset as number) || 0;
      const workoutDate = addDays(startDate, dayOffset);
      const prescription = w.prescription || {};

      return {
        season_id: season.id,
        user_id: user.id,
        date: formatDate(workoutDate),
        week_number: (w.week_number as number) || Math.floor(dayOffset / 7) + 1,
        day_of_week: (w.day_of_week as number) || (workoutDate.getDay() === 0 ? 7 : workoutDate.getDay()),
        workout_type: w.workout_type || "rest",
        title: (w.title as string) || "Rest Day",
        intensity: (w.intensity as string) || "rest",
        duration_minutes: (w.duration_minutes as number) || null,
        prescription_json: prescription,
      };
    });

    const { error: workoutsError } = await serviceClient
      .from("season_workouts")
      .insert(workoutRows);

    if (workoutsError) {
      console.error("Workouts insert error:", workoutsError);
      // Clean up the season since workouts failed
      await serviceClient.from("training_seasons").delete().eq("id", season.id);
      return jsonResponse({ error: "Failed to save workout plan" }, 500);
    }

    return jsonResponse({
      season_id: season.id,
      season_number: seasonNumber,
      name: parsed.plan.name,
      start_date: formatDate(startDate),
      end_date: formatDate(endDate),
      duration_weeks: durationWeeks,
      total_workouts: workoutRows.length,
      plan: parsed.plan,
    });
  } catch (err) {
    console.error("season-create error:", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
