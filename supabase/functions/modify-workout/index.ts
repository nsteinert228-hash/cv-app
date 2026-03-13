import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { gatherHealthData, formatHealthDataForPrompt } from "../_shared/healthData.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are an elite personal trainer modifying a client's workout for today based on their request.

Rules:
- Respond ONLY with valid JSON — no markdown fences, no commentary
- Modify the workout according to the client's request
- Keep the modification reasonable and safe
- If the change affects the weekly balance (e.g., swapping legs for upper body), suggest adjustments for remaining days
- Maintain the overall training plan's integrity
- Use the same exercise format as the original prescription`;

const RESPONSE_SCHEMA = `{
  "modified_workout": {
    "workout_type": "strength | cardio | recovery | mixed | rest",
    "title": "string",
    "intensity": "high | moderate | low | rest",
    "duration_minutes": 45,
    "prescription": {
      "description": "string",
      "warmup": ["string"],
      "exercises": [
        {
          "exercise": "string",
          "sets": 3,
          "reps": "8-12",
          "rest_seconds": 60,
          "notes": "optional"
        }
      ],
      "cooldown": ["string"]
    }
  },
  "week_adjustments": [
    {
      "date": "YYYY-MM-DD",
      "reason": "string",
      "workout_type": "string",
      "title": "string",
      "intensity": "string",
      "duration_minutes": 45,
      "prescription": { ... same format ... }
    }
  ],
  "explanation": "Brief explanation of changes made"
}

If no week adjustments are needed, return empty array for week_adjustments.`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

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

    const body = await req.json();
    const workoutId = body.workout_id;
    const userPrompt = body.user_prompt;
    const seasonId = body.season_id;

    if (!workoutId || !userPrompt || !seasonId) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Handle undo ──
    if (userPrompt === "__UNDO__") {
      const { data: lastMod } = await serviceClient
        .from("workout_modifications")
        .select("original_workout")
        .eq("user_id", user.id)
        .eq("season_id", seasonId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!lastMod) {
        return jsonResponse({ error: "No modification to undo" }, 404);
      }

      const original = lastMod.original_workout as Record<string, unknown>;
      await serviceClient
        .from("season_workouts")
        .update({
          workout_type: original.workout_type,
          title: original.title,
          intensity: original.intensity,
          duration_minutes: original.duration_minutes,
          prescription_json: original.prescription_json,
          is_adapted: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", workoutId);

      return jsonResponse({ undone: true });
    }

    // ── Fetch current workout ──
    const { data: workout, error: workoutErr } = await serviceClient
      .from("season_workouts")
      .select("*")
      .eq("id", workoutId)
      .eq("user_id", user.id)
      .single();

    if (workoutErr || !workout) {
      return jsonResponse({ error: "Workout not found" }, 404);
    }

    // ── Fetch week context ──
    const { data: weekWorkouts } = await serviceClient
      .from("season_workouts")
      .select("id, date, week_number, workout_type, title, intensity, duration_minutes")
      .eq("season_id", seasonId)
      .eq("week_number", workout.week_number)
      .order("date", { ascending: true });

    // ── Fetch season config ──
    const { data: season } = await serviceClient
      .from("training_seasons")
      .select("plan_json, training_type, skill_level, avoided_exercises, preferred_activities")
      .eq("id", seasonId)
      .single();

    // ── Gather health data ──
    const healthData = await gatherHealthData(serviceClient, user.id);
    const healthPrompt = formatHealthDataForPrompt(healthData);

    // ── Build prompt ──
    const avoidedList = (season?.avoided_exercises as string[])?.length
      ? `\nCRITICAL: Do NOT include these exercises: ${(season.avoided_exercises as string[]).join(", ")}`
      : "";

    const userMessage = `${healthPrompt}

---

### Current Workout (${workout.date})
${JSON.stringify({
      type: workout.workout_type,
      title: workout.title,
      intensity: workout.intensity,
      duration_minutes: workout.duration_minutes,
      prescription: workout.prescription_json,
    }, null, 2)}

### This Week's Schedule
${JSON.stringify(weekWorkouts || [], null, 2)}

### Season Context
- Training Type: ${season?.training_type || "general"}
- Skill Level: ${season?.skill_level || "intermediate"}
${avoidedList}

### User's Request
"${userPrompt}"

---

Modify today's workout according to the user's request.
Also adjust remaining days this week if the change affects weekly balance.
Today is ${formatDate(new Date())}.

Respond as JSON matching this schema:
${RESPONSE_SCHEMA}`;

    // ── Call Claude ──
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

    let parsed: {
      modified_workout: Record<string, unknown>;
      week_adjustments: Record<string, unknown>[];
      explanation: string;
    };
    try {
      const cleaned = rawText.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse modification response:", rawText.substring(0, 500));
      return jsonResponse({ error: "Failed to parse AI response" }, 502);
    }

    const mod = parsed.modified_workout;
    if (!mod) {
      return jsonResponse({ error: "Invalid modification response" }, 502);
    }

    // ── Save original for undo ──
    await serviceClient.from("workout_modifications").insert({
      user_id: user.id,
      season_id: seasonId,
      workout_date: workout.date,
      user_prompt: userPrompt,
      original_workout: {
        workout_type: workout.workout_type,
        title: workout.title,
        intensity: workout.intensity,
        duration_minutes: workout.duration_minutes,
        prescription_json: workout.prescription_json,
      },
      modified_workout: mod,
      affected_dates: (parsed.week_adjustments || []).map((a) => a.date),
    });

    // ── Update today's workout ──
    await serviceClient
      .from("season_workouts")
      .update({
        workout_type: mod.workout_type || workout.workout_type,
        title: mod.title || workout.title,
        intensity: mod.intensity || workout.intensity,
        duration_minutes: mod.duration_minutes || workout.duration_minutes,
        prescription_json: mod.prescription || workout.prescription_json,
        is_adapted: true,
        version: (workout.version || 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workoutId);

    // ── Apply week adjustments ──
    const adjustedDates: string[] = [];
    for (const adj of parsed.week_adjustments || []) {
      const adjDate = adj.date as string;
      if (!adjDate) continue;

      const matchingWorkout = (weekWorkouts || []).find(
        (w) => (w as Record<string, unknown>).date === adjDate && (w as Record<string, unknown>).id !== workoutId,
      );
      if (!matchingWorkout) continue;

      await serviceClient
        .from("season_workouts")
        .update({
          workout_type: adj.workout_type || (matchingWorkout as Record<string, unknown>).workout_type,
          title: adj.title || (matchingWorkout as Record<string, unknown>).title,
          intensity: adj.intensity || (matchingWorkout as Record<string, unknown>).intensity,
          duration_minutes: adj.duration_minutes || (matchingWorkout as Record<string, unknown>).duration_minutes,
          prescription_json: adj.prescription || {},
          is_adapted: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", (matchingWorkout as Record<string, unknown>).id);

      adjustedDates.push(adjDate);
    }

    // ── Log as adaptation ──
    await serviceClient.from("season_adaptations").insert({
      season_id: seasonId,
      user_id: user.id,
      affected_date: workout.date,
      trigger: "schedule",
      summary: `User modification: "${userPrompt}" — ${parsed.explanation || "Workout updated"}`,
      changes_json: parsed,
      proximity: "near_term",
      acknowledged: true,
    });

    return jsonResponse({
      modified_workout: mod,
      explanation: parsed.explanation,
      adjusted_dates: adjustedDates,
      original_workout: {
        workout_type: workout.workout_type,
        title: workout.title,
      },
    });
  } catch (err) {
    console.error("modify-workout error:", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
