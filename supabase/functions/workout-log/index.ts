import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ── Helpers ─────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function computeAdherenceScore(
  prescription: Record<string, unknown>,
  actual: Record<string, unknown>,
  status: string,
): number {
  if (status === "skipped") return 0;

  const prescribed = (prescription.exercises as unknown[]) || (prescription.main_workout as unknown[]) || [];
  const performed = (actual.exercises as unknown[]) || [];

  if (prescribed.length === 0) return 100;

  let totalScore = 0;
  let matchCount = 0;

  for (const rx of prescribed) {
    const rxEx = rx as Record<string, unknown>;
    const rxName = ((rxEx.exercise as string) || "").toLowerCase();
    const rxSets = (rxEx.sets as number) || 0;
    const rxWeight = (rxEx.weight as number) || 0;

    // Find matching performed exercise
    const match = performed.find((p) => {
      const pEx = p as Record<string, unknown>;
      return ((pEx.exercise as string) || "").toLowerCase() === rxName;
    }) as Record<string, unknown> | undefined;

    if (match) {
      matchCount++;
      const actualSets = (match.sets_completed as number) || 0;
      const actualWeight = (match.weight as number) || 0;

      const setRatio = rxSets > 0 ? Math.min(actualSets / rxSets, 1.0) : 1.0;

      // Weight adherence: bonus/penalty when both prescribed and actual weights exist
      let weightFactor = 1.0;
      if (rxWeight > 0 && actualWeight > 0) {
        const weightRatio = actualWeight / rxWeight;
        // Hitting target or exceeding slightly (up to 110%) is perfect
        // Under-shooting or overshooting beyond 110% reduces score proportionally
        weightFactor = weightRatio >= 0.9 && weightRatio <= 1.1
          ? 1.0
          : Math.max(0.5, 1.0 - Math.abs(1.0 - weightRatio));
      }

      // Combine set adherence (70%) and weight adherence (30%) when weights exist
      const hasWeights = rxWeight > 0 && actualWeight > 0;
      const exerciseScore = hasWeights
        ? (setRatio * 0.7 + weightFactor * 0.3) * 100
        : setRatio * 100;

      totalScore += exerciseScore;
    }
  }

  // Weighted: exercises completed + volume adherence
  const completionRatio = prescribed.length > 0 ? matchCount / prescribed.length : 1;
  const volumeScore = matchCount > 0 ? totalScore / matchCount : 0;

  return Math.round(completionRatio * 0.5 * 100 + volumeScore * 0.5);
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
    const { workout_id, status, actual_json, garmin_activity_id, notes, source: requestedSource, rpe: bodyRpe } = body;

    if (!workout_id) return jsonResponse({ error: "workout_id required" }, 400);
    if (!status || !["completed", "partial", "skipped", "substituted"].includes(status)) {
      return jsonResponse({ error: "Invalid status" }, 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Verify workout belongs to user ──
    const { data: workout, error: workoutError } = await serviceClient
      .from("season_workouts")
      .select("id, date, prescription_json, season_id")
      .eq("id", workout_id)
      .eq("user_id", user.id)
      .single();

    if (workoutError || !workout) {
      return jsonResponse({ error: "Workout not found" }, 404);
    }

    // ── Check for existing log ──
    const { data: existing } = await serviceClient
      .from("workout_logs")
      .select("id")
      .eq("workout_id", workout_id)
      .maybeSingle();

    const actualData = actual_json || {};

    // ── Auto-fill from Garmin if activity ID provided ──
    if (garmin_activity_id && !actual_json) {
      const { data: activity } = await serviceClient
        .from("activities")
        .select("activity_type, duration_seconds, distance_meters, calories, avg_heart_rate, max_heart_rate")
        .eq("user_id", user.id)
        .eq("activity_id", garmin_activity_id)
        .single();

      if (activity) {
        Object.assign(actualData, {
          source_activity: activity,
          duration_minutes: Math.round((activity.duration_seconds || 0) / 60),
          distance_meters: activity.distance_meters,
          avg_heart_rate: activity.avg_heart_rate,
        });
      }
    }

    // ── Compute adherence ──
    const adherenceScore = computeAdherenceScore(
      (workout.prescription_json as Record<string, unknown>) || {},
      actualData,
      status,
    );

    // Extract RPE — either from actual_json.rpe (client-side) or body.rpe
    const rpeRaw = (actualData as Record<string, unknown>).rpe ?? bodyRpe;
    const rpe = typeof rpeRaw === "number" && rpeRaw >= 1 && rpeRaw <= 10
      ? Math.round(rpeRaw)
      : null;
    // Remove rpe from actual_json to avoid duplication — it's stored as a column
    if ("rpe" in (actualData as Record<string, unknown>)) {
      delete (actualData as Record<string, unknown>).rpe;
    }

    const validSources = ["manual", "garmin_auto", "garmin_confirmed"];
    const source = (requestedSource && validSources.includes(requestedSource))
      ? requestedSource
      : garmin_activity_id ? "garmin_confirmed" : "manual";

    // ── Insert or update ──
    if (existing) {
      const { error: updateError } = await serviceClient
        .from("workout_logs")
        .update({
          status,
          source,
          actual_json: actualData,
          garmin_activity_id: garmin_activity_id || null,
          adherence_score: adherenceScore,
          rpe,
          notes: notes || null,
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("Log update error:", updateError);
        return jsonResponse({ error: "Failed to update log" }, 500);
      }

      return jsonResponse({
        log_id: existing.id,
        workout_id,
        status,
        adherence_score: adherenceScore,
        updated: true,
      });
    }

    const { data: log, error: insertError } = await serviceClient
      .from("workout_logs")
      .insert({
        workout_id,
        user_id: user.id,
        date: workout.date,
        status,
        source,
        actual_json: actualData,
        garmin_activity_id: garmin_activity_id || null,
        adherence_score: adherenceScore,
        rpe,
        notes: notes || null,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Log insert error:", insertError);
      return jsonResponse({ error: "Failed to save log" }, 500);
    }

    return jsonResponse({
      log_id: log.id,
      workout_id,
      status,
      adherence_score: adherenceScore,
      updated: false,
    });
  } catch (err) {
    console.error("workout-log error:", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
