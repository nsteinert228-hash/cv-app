import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { gatherHealthData, formatHealthDataForPrompt } from "../_shared/healthData.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;
const RATE_LIMIT_HOURS = 6;

// ── Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an elite personal trainer reviewing a client's active training plan against their current health data, Garmin metrics, and recent adherence.

Rules:
- Respond ONLY with valid JSON — no markdown fences, no commentary
- Only suggest adaptations when health data or adherence clearly warrants a change
- Prioritize safety: if recovery indicators are poor, reduce intensity/volume
- Do NOT change the overall training split or exercise selection unless 3+ consecutive days are missed
- You may adjust: intensity, volume (sets/reps), duration, rest periods, and swap exercises of similar type
- Preserve the progressive overload structure of the season
- For rest/recovery days, you may upgrade to active recovery or light training if readiness is high
- If no changes are needed, return an empty adaptations array

Key Garmin metrics to consider:
- Sleep score < 60: reduce intensity, consider recovery day
- Body battery < 30: mandatory easy/rest day
- HRV status "low" or "unbalanced": reduce volume and intensity
- Stress avg > 50: consider lighter sessions
- Consecutive poor sleep (3+ days): reduce week's overall volume
- High readiness indicators: consider progressive overload opportunity

Activity quality analysis (from "Activity Quality Details"):
- Compare prescribed workout type with actual classification (e.g., prescribed tempo but classified as "recovery" = undertrained session)
- HR zone distribution shows training stimulus quality (e.g., >50% in z4/z5 for intervals, >60% in z2 for easy runs)
- If recent activities show consistent underperformance vs. prescription, consider reducing targets
- If recent activities exceed prescription quality, consider progressive overload`;

const RESPONSE_SCHEMA = `{
  "adaptations": [
    {
      "date": "YYYY-MM-DD",
      "reason": "short trigger description e.g. 'HRV dropped 15%'",
      "summary": "human-readable change description e.g. 'Reducing intensity from high to moderate for upper body session'",
      "trigger": "hrv_drop | sleep_decline | high_stress | missed_workout | overtraining | high_readiness | schedule",
      "updated_prescription": {
        "description": "string",
        "warmup": { "duration_minutes": 5, "activities": ["string"] },
        "main_workout": [
          { "exercise": "string", "sets": 3, "reps": "8-12", "rest_seconds": 60, "notes": "string" }
        ],
        "cooldown": { "duration_minutes": 5, "activities": ["string"] }
      },
      "updated_intensity": "high | moderate | low | rest",
      "updated_duration_minutes": 45
    }
  ]
}

If no adaptations needed, return: { "adaptations": [] }`;

// ── Helpers ─────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
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
    const force = body.force === true;
    const dryRun = body.dry_run === true;
    const applyMode = body.apply === true;
    const rejectMode = body.reject === true;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Get active season ──
    const { data: season, error: seasonError } = await serviceClient
      .from("training_seasons")
      .select("id, plan_json, start_date, end_date")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (seasonError || !season) {
      return jsonResponse({ error: "No active season" }, 404);
    }

    // ── Handle apply/reject of previously proposed changes ──
    if (applyMode && body.payload) {
      const payload = body.payload;
      const changes = payload.proposed_changes || [];
      const thisWeekEnd = new Date();
      const dayOfWeek = thisWeekEnd.getDay();
      const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
      thisWeekEnd.setDate(thisWeekEnd.getDate() + daysUntilSunday);
      const thisWeekEndStr = formatDate(thisWeekEnd);
      let applied = 0;

      for (const change of changes) {
        if (change.no_change || !change.workout_id) continue;
        const proposed = change.proposed;
        if (!proposed) continue;

        // Save original before overwriting
        const { data: currentWorkout } = await serviceClient
          .from("season_workouts")
          .select("prescription_json, workout_type, intensity, version")
          .eq("id", change.workout_id)
          .single();

        const currentVersion = (currentWorkout?.version as number) || 1;
        const updateFields: Record<string, unknown> = {
          is_adapted: true,
          version: currentVersion + 1,
          updated_at: new Date().toISOString(),
          original_prescription_json: currentWorkout?.prescription_json,
          original_workout_type: currentWorkout?.workout_type,
          original_intensity: currentWorkout?.intensity,
        };
        if (proposed.prescription_json) updateFields.prescription_json = proposed.prescription_json;
        if (proposed.intensity) updateFields.intensity = proposed.intensity;
        if (proposed.workout_type) updateFields.workout_type = proposed.workout_type;
        if (proposed.duration_minutes) updateFields.duration_minutes = proposed.duration_minutes;
        if (proposed.title) updateFields.title = proposed.title;

        await serviceClient.from("season_workouts").update(updateFields).eq("id", change.workout_id);
        applied++;
      }

      // Log the adaptation
      const approvalStatus = payload.partial ? "partially_approved" : "approved";
      await serviceClient.from("season_adaptations").insert({
        season_id: season.id,
        user_id: user.id,
        affected_date: formatDate(new Date()),
        trigger: payload.trigger || "unknown",
        summary: payload.summary || "Plan adjusted",
        changes_json: { proposed_changes: changes },
        proposed_changes_json: { proposed_changes: payload.proposed_changes },
        readiness_snapshot: payload.readiness_snapshot || null,
        approval_status: approvalStatus,
        proximity: "near_term",
      });

      return jsonResponse({ _applied: applied, approval_status: approvalStatus });
    }

    if (rejectMode && body.payload) {
      const payload = body.payload;
      await serviceClient.from("season_adaptations").insert({
        season_id: season.id,
        user_id: user.id,
        affected_date: formatDate(new Date()),
        trigger: payload.trigger || "unknown",
        summary: payload.summary || "Plan changes rejected",
        changes_json: { proposed_changes: payload.proposed_changes || [] },
        proposed_changes_json: { proposed_changes: payload.proposed_changes || [] },
        readiness_snapshot: payload.readiness_snapshot || null,
        approval_status: "rejected",
        proximity: "near_term",
        acknowledged: true,
      });
      return jsonResponse({ approval_status: "rejected" });
    }

    // ── Rate limit check ──
    if (!force) {
      const cutoff = new Date();
      cutoff.setHours(cutoff.getHours() - RATE_LIMIT_HOURS);

      const { data: recentAdapts } = await serviceClient
        .from("season_adaptations")
        .select("id")
        .eq("season_id", season.id)
        .gte("created_at", cutoff.toISOString())
        .limit(1);

      if (recentAdapts && recentAdapts.length > 0) {
        return jsonResponse({ adaptations: [], _skipped: true, _reason: "rate_limited" });
      }
    }

    // ── Fetch upcoming 14 days of workouts ──
    const today = formatDate(new Date());
    const twoWeeksOut = new Date();
    twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

    const { data: upcomingWorkouts } = await serviceClient
      .from("season_workouts")
      .select("id, date, week_number, workout_type, title, intensity, duration_minutes, prescription_json, is_adapted")
      .eq("season_id", season.id)
      .gte("date", today)
      .lte("date", formatDate(twoWeeksOut))
      .order("date", { ascending: true });

    // ── Fetch recent workout logs (last 7 days) ──
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentLogs } = await serviceClient
      .from("workout_logs")
      .select("date, status, adherence_score")
      .eq("user_id", user.id)
      .gte("date", formatDate(sevenDaysAgo))
      .order("date", { ascending: true });

    // ── Gather current health data ──
    const healthData = await gatherHealthData(serviceClient, user.id);
    const healthPrompt = formatHealthDataForPrompt(healthData);

    // ── Build prompt ──
    const userMessage = `${healthPrompt}

---

### Active Season Plan Summary
${JSON.stringify(season.plan_json, null, 2)}

### Upcoming Workouts (next 14 days)
${JSON.stringify(upcomingWorkouts || [], null, 2)}

### Recent Workout Logs (last 7 days)
${JSON.stringify(recentLogs || [], null, 2)}

---

Today is ${today}.
Review the upcoming workouts against the client's current health data and recent adherence.
Suggest adaptations ONLY where clearly warranted.
Near-term = today through end of this week. Future = next week and beyond.

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

    let parsed: { adaptations: Record<string, unknown>[] };
    try {
      const cleaned = rawText.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse adaptation response:", rawText.substring(0, 500));
      return jsonResponse({ error: "Failed to parse AI response" }, 502);
    }

    const adaptations = parsed.adaptations || [];
    if (adaptations.length === 0) {
      return jsonResponse({ adaptations: [], has_changes: false, _applied: 0 });
    }

    // Build readiness snapshot from health data
    const readinessSnapshot = {
      sleep_score: healthData?.todaySnapshot?.sleep_score ?? null,
      body_battery: healthData?.todaySnapshot?.body_battery ?? null,
      hrv_status: healthData?.todaySnapshot?.hrv_status ?? null,
      stress_avg: healthData?.todaySnapshot?.stress_avg ?? null,
    };

    // ── Dry run: return proposals without applying ──
    if (dryRun) {
      const proposedChanges = adaptations.map((adapt) => {
        const affectedDate = adapt.date as string;
        const matchingWorkout = (upcomingWorkouts || []).find(
          (w) => (w as Record<string, unknown>).date === affectedDate,
        );

        if (!matchingWorkout) {
          return { date: affectedDate, no_change: true };
        }

        const mw = matchingWorkout as Record<string, unknown>;
        return {
          workout_id: mw.id,
          date: affectedDate,
          day_of_week: mw.day_of_week || new Date(affectedDate + "T00:00:00").getDay(),
          original: {
            title: mw.title,
            workout_type: mw.workout_type,
            intensity: mw.intensity,
            duration_minutes: mw.duration_minutes,
            prescription_json: mw.prescription_json,
          },
          proposed: {
            title: (adapt.updated_prescription as Record<string, unknown>)?.description
              ? mw.title
              : mw.title,
            workout_type: adapt.updated_intensity === "rest"
              ? "rest"
              : (mw.workout_type as string),
            intensity: adapt.updated_intensity || mw.intensity,
            duration_minutes: adapt.updated_duration_minutes || mw.duration_minutes,
            prescription_json: adapt.updated_prescription || mw.prescription_json,
          },
          change_summary: adapt.summary as string,
          no_change: false,
        };
      });

      // Determine primary trigger (most severe)
      const triggerPriority = ["overtraining", "hrv_drop", "high_stress", "sleep_decline", "missed_workout", "high_readiness", "schedule"];
      const triggers = adaptations.map(a => a.trigger as string);
      const primaryTrigger = triggerPriority.find(t => triggers.includes(t)) || triggers[0] || "schedule";

      return jsonResponse({
        has_changes: true,
        trigger: primaryTrigger,
        summary: adaptations[0]?.summary || "AI suggests plan adjustments",
        readiness_snapshot: readinessSnapshot,
        proposed_changes: proposedChanges,
      });
    }

    // ── Auto-apply adaptations (legacy behavior when no dry_run flag) ──
    let applied = 0;
    const thisWeekEnd = new Date();
    const dayOfWeek = thisWeekEnd.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    thisWeekEnd.setDate(thisWeekEnd.getDate() + daysUntilSunday);
    const thisWeekEndStr = formatDate(thisWeekEnd);

    for (const adapt of adaptations) {
      const affectedDate = adapt.date as string;
      if (!affectedDate) continue;

      const matchingWorkout = (upcomingWorkouts || []).find(
        (w) => (w as Record<string, unknown>).date === affectedDate,
      );
      if (!matchingWorkout) continue;

      const mw = matchingWorkout as Record<string, unknown>;
      const workoutId = mw.id as string;
      const currentVersion = (mw.version as number) || 1;
      const proximity = affectedDate <= thisWeekEndStr ? "near_term" : "future";

      const updateFields: Record<string, unknown> = {
        is_adapted: true,
        version: currentVersion + 1,
        updated_at: new Date().toISOString(),
        original_prescription_json: mw.prescription_json,
        original_workout_type: mw.workout_type,
        original_intensity: mw.intensity,
      };

      if (adapt.updated_prescription) updateFields.prescription_json = adapt.updated_prescription;
      if (adapt.updated_intensity) updateFields.intensity = adapt.updated_intensity;
      if (adapt.updated_duration_minutes) updateFields.duration_minutes = adapt.updated_duration_minutes;

      const { error: updateError } = await serviceClient
        .from("season_workouts")
        .update(updateFields)
        .eq("id", workoutId);

      if (updateError) {
        console.error("Workout update error:", updateError);
        continue;
      }

      await serviceClient.from("season_adaptations").insert({
        season_id: season.id,
        user_id: user.id,
        affected_date: affectedDate,
        trigger: (adapt.trigger as string) || "unknown",
        summary: (adapt.summary as string) || "Plan adjusted",
        changes_json: adapt,
        readiness_snapshot: readinessSnapshot,
        approval_status: "auto_applied",
        proximity,
      });

      applied++;
    }

    return jsonResponse({
      has_changes: true,
      adaptations: adaptations.map((a) => ({
        date: a.date,
        summary: a.summary,
        trigger: a.trigger,
        proximity: (a.date as string) <= thisWeekEndStr ? "near_term" : "future",
      })),
      _applied: applied,
    });
  } catch (err) {
    console.error("season-adapt error:", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
