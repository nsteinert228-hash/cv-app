import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 2048;

const SYSTEM_PROMPT = `You are an elite personal trainer summarizing a completed training season.

Rules:
- Respond ONLY with valid JSON — no markdown fences, no commentary
- Analyze adherence patterns, highlight achievements and areas that need attention
- Provide actionable recommendations for the next season
- Be encouraging but honest about areas for improvement`;

const SUMMARY_SCHEMA = `{
  "summary": "3-5 sentence narrative of the season",
  "highlights": ["key achievements or positive trends"],
  "areas_for_improvement": ["things to focus on next season"],
  "adherence_analysis": {
    "overall_rating": "excellent | good | fair | poor",
    "consistency_note": "observation about workout consistency"
  },
  "next_season_recommendations": {
    "suggested_focus": "string",
    "intensity_adjustment": "increase | maintain | decrease",
    "notes": "string"
  }
}`;

// ── Helpers ─────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    const body = await req.json();
    const { season_id } = body;
    if (!season_id) return jsonResponse({ error: "season_id required" }, 400);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Fetch season ──
    const { data: season, error: seasonError } = await serviceClient
      .from("training_seasons")
      .select("id, name, plan_json, duration_weeks, start_date, end_date, status")
      .eq("id", season_id)
      .eq("user_id", user.id)
      .single();

    if (seasonError || !season) {
      return jsonResponse({ error: "Season not found" }, 404);
    }

    if (season.status === "completed") {
      return jsonResponse({ error: "Season already completed" }, 409);
    }

    // ── Fetch all workout logs for this season ──
    const { data: workouts } = await serviceClient
      .from("season_workouts")
      .select("id, date, workout_type, title, intensity")
      .eq("season_id", season_id)
      .order("date", { ascending: true });

    const workoutIds = (workouts || []).map((w) => (w as Record<string, unknown>).id);

    const { data: logs } = await serviceClient
      .from("workout_logs")
      .select("workout_id, status, adherence_score, date")
      .in("workout_id", workoutIds);

    // ── Compute stats ──
    const totalWorkouts = (workouts || []).filter(
      (w) => (w as Record<string, unknown>).workout_type !== "rest",
    ).length;
    const logMap = new Map(
      (logs || []).map((l) => [(l as Record<string, unknown>).workout_id, l]),
    );

    let completed = 0;
    let partial = 0;
    let skipped = 0;
    let totalAdherence = 0;
    let adherenceCount = 0;

    for (const w of workouts || []) {
      if ((w as Record<string, unknown>).workout_type === "rest") continue;
      const log = logMap.get((w as Record<string, unknown>).id) as Record<string, unknown> | undefined;
      if (!log) {
        skipped++;
        continue;
      }
      if (log.status === "completed") completed++;
      else if (log.status === "partial") partial++;
      else if (log.status === "skipped") skipped++;

      if (log.adherence_score != null) {
        totalAdherence += log.adherence_score as number;
        adherenceCount++;
      }
    }

    const avgAdherence = adherenceCount > 0 ? Math.round(totalAdherence / adherenceCount) : 0;
    const completionRate = totalWorkouts > 0 ? Math.round(((completed + partial) / totalWorkouts) * 100) : 0;

    const stats = {
      total_workouts: totalWorkouts,
      completed,
      partial,
      skipped,
      unlogged: totalWorkouts - completed - partial - skipped,
      avg_adherence: avgAdherence,
      completion_rate: completionRate,
    };

    // ── Call Claude for narrative summary ──
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const userMessage = `### Season: ${season.name}
Duration: ${season.duration_weeks} weeks (${season.start_date} to ${season.end_date})

### Season Plan
${JSON.stringify(season.plan_json, null, 2)}

### Adherence Stats
${JSON.stringify(stats, null, 2)}

### Workout Log Summary
${JSON.stringify(
      (logs || []).map((l) => ({
        date: (l as Record<string, unknown>).date,
        status: (l as Record<string, unknown>).status,
        adherence: (l as Record<string, unknown>).adherence_score,
      })),
      null,
      2,
    )}

---

Summarize this completed season. Respond as JSON matching this schema:
${SUMMARY_SCHEMA}`;

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

    let completionSummary: unknown = { stats };

    if (claudeRes.ok) {
      const claudeData = await claudeRes.json();
      const rawText = claudeData.content?.[0]?.text || "";
      try {
        const cleaned = rawText.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
        const aiSummary = JSON.parse(cleaned);
        completionSummary = { ...aiSummary, stats };
      } catch {
        console.error("Failed to parse completion summary");
      }
    }

    // ── Mark season complete ──
    const { error: updateError } = await serviceClient
      .from("training_seasons")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completion_summary: completionSummary,
      })
      .eq("id", season_id);

    if (updateError) {
      console.error("Season update error:", updateError);
      return jsonResponse({ error: "Failed to complete season" }, 500);
    }

    return jsonResponse({
      season_id,
      status: "completed",
      completion_summary: completionSummary,
    });
  } catch (err) {
    console.error("season-complete error:", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
