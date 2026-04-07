import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get user from auth token
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { attempt_id } = await req.json();
    if (!attempt_id) {
      return new Response(JSON.stringify({ error: "Missing attempt_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the attempt
    const { data: attempt, error: attemptError } = await supabase
      .from("murph_attempts")
      .select("*")
      .eq("id", attempt_id)
      .eq("user_id", user.id)
      .single();

    if (attemptError || !attempt) {
      return new Response(JSON.stringify({ error: "Attempt not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const startWindow = new Date(
      new Date(attempt.started_at).getTime() - 5 * 60 * 1000
    ).toISOString();
    const endWindow = attempt.finished_at
      ? new Date(
          new Date(attempt.finished_at).getTime() + 5 * 60 * 1000
        ).toISOString()
      : new Date().toISOString();

    // Find running activities in the time window
    const { data: activities } = await supabase
      .from("activities")
      .select("*")
      .eq("user_id", user.id)
      .or("activity_type.ilike.%running%,activity_type.ilike.%run%")
      .gte("start_time", startWindow)
      .lte("start_time", endWindow)
      .order("start_time", { ascending: true });

    if (!activities || activities.length === 0) {
      return new Response(
        JSON.stringify({
          matched: false,
          message: "No running activities found. Garmin data may not have synced yet.",
          mile1: null,
          mile2: null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter to ~1 mile activities (1400m - 2000m)
    const mileActivities = activities.filter(
      (a: any) => a.distance_meters >= 1400 && a.distance_meters <= 2000
    );

    // Check for single long run (>= 2800m)
    const longRuns = activities.filter(
      (a: any) => a.distance_meters >= 2800
    );

    let mile1Data: any = null;
    let mile2Data: any = null;

    if (mileActivities.length >= 2) {
      // Two separate ~1-mile runs
      mile1Data = buildMileData(mileActivities[0]);
      mile2Data = buildMileData(mileActivities[mileActivities.length - 1]);
    } else if (longRuns.length > 0) {
      // Single long run — try to split it
      const longRun = longRuns[0];

      // Check for splits in activity_metrics
      const { data: metrics } = await supabase
        .from("activity_metrics")
        .select("splits")
        .eq("activity_id", longRun.activity_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (metrics?.splits && Array.isArray(metrics.splits) && metrics.splits.length >= 2) {
        const firstSplit = metrics.splits[0];
        const lastSplit = metrics.splits[metrics.splits.length - 1];
        const startTime = new Date(longRun.start_time);

        mile1Data = {
          garmin_activity_id: longRun.activity_id,
          start_at: longRun.start_time,
          end_at: new Date(startTime.getTime() + (firstSplit.duration_seconds || 0) * 1000).toISOString(),
          time_seconds: firstSplit.duration_seconds || null,
          distance_meters: firstSplit.distance_meters || null,
          avg_pace: firstSplit.avg_pace || null,
          avg_hr: firstSplit.avg_heart_rate || longRun.avg_heart_rate,
        };

        const lastSplitStart = new Date(
          startTime.getTime() + (longRun.duration_seconds - (lastSplit.duration_seconds || 0)) * 1000
        );
        mile2Data = {
          garmin_activity_id: longRun.activity_id,
          start_at: lastSplitStart.toISOString(),
          end_at: new Date(startTime.getTime() + longRun.duration_seconds * 1000).toISOString(),
          time_seconds: lastSplit.duration_seconds || null,
          distance_meters: lastSplit.distance_meters || null,
          avg_pace: lastSplit.avg_pace || null,
          avg_hr: lastSplit.avg_heart_rate || longRun.avg_heart_rate,
        };
      } else {
        // No splits — estimate by halving
        const halfDuration = longRun.duration_seconds / 2;
        const halfDistance = longRun.distance_meters / 2;
        const startTime = new Date(longRun.start_time);

        mile1Data = {
          garmin_activity_id: longRun.activity_id,
          start_at: longRun.start_time,
          end_at: new Date(startTime.getTime() + halfDuration * 1000).toISOString(),
          time_seconds: halfDuration,
          distance_meters: halfDistance,
          avg_pace: longRun.avg_pace,
          avg_hr: longRun.avg_heart_rate,
        };
        mile2Data = {
          garmin_activity_id: longRun.activity_id,
          start_at: new Date(startTime.getTime() + halfDuration * 1000).toISOString(),
          end_at: new Date(startTime.getTime() + longRun.duration_seconds * 1000).toISOString(),
          time_seconds: halfDuration,
          distance_meters: halfDistance,
          avg_pace: longRun.avg_pace,
          avg_hr: longRun.avg_heart_rate,
        };
      }
    } else if (mileActivities.length === 1) {
      // Only one mile found
      mile1Data = buildMileData(mileActivities[0]);
    }

    // Update the attempt with matched data
    const updatePayload: any = {};
    if (mile1Data) {
      updatePayload.mile1_garmin_activity_id = mile1Data.garmin_activity_id;
      updatePayload.mile1_start_at = mile1Data.start_at;
      updatePayload.mile1_end_at = mile1Data.end_at;
      updatePayload.mile1_time_seconds = mile1Data.time_seconds;
      updatePayload.mile1_distance_meters = mile1Data.distance_meters;
      updatePayload.mile1_avg_pace = mile1Data.avg_pace;
      updatePayload.mile1_avg_hr = mile1Data.avg_hr;
    }
    if (mile2Data) {
      updatePayload.mile2_garmin_activity_id = mile2Data.garmin_activity_id;
      updatePayload.mile2_start_at = mile2Data.start_at;
      updatePayload.mile2_end_at = mile2Data.end_at;
      updatePayload.mile2_time_seconds = mile2Data.time_seconds;
      updatePayload.mile2_distance_meters = mile2Data.distance_meters;
      updatePayload.mile2_avg_pace = mile2Data.avg_pace;
      updatePayload.mile2_avg_hr = mile2Data.avg_hr;
    }

    if (mile1Data && mile2Data) {
      // Compute verified total time
      const verifiedTotal =
        (new Date(mile2Data.end_at).getTime() - new Date(mile1Data.start_at).getTime()) / 1000;
      updatePayload.total_time_seconds = verifiedTotal;

      // Check discrepancy with app timer
      if (attempt.total_time_seconds) {
        const discrepancy = Math.abs(verifiedTotal - attempt.total_time_seconds);
        if (discrepancy > 120) {
          console.warn(
            `Timing discrepancy: app=${attempt.total_time_seconds}s, garmin=${verifiedTotal}s, diff=${discrepancy}s`
          );
        }
      }

      updatePayload.status = "verified";
    }

    if (Object.keys(updatePayload).length > 0) {
      await supabase
        .from("murph_attempts")
        .update(updatePayload)
        .eq("id", attempt_id);
    }

    return new Response(
      JSON.stringify({
        matched: !!(mile1Data && mile2Data),
        mile1: mile1Data,
        mile2: mile2Data,
        message: mile1Data && mile2Data
          ? "Both miles verified via Garmin"
          : mile1Data
          ? "Mile 1 verified. Mile 2 pending."
          : "No miles matched yet. Try syncing Garmin data.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("murph-match-miles error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function buildMileData(activity: any) {
  const startTime = new Date(activity.start_time);
  const endTime = new Date(startTime.getTime() + activity.duration_seconds * 1000);
  return {
    garmin_activity_id: activity.activity_id,
    start_at: activity.start_time,
    end_at: endTime.toISOString(),
    time_seconds: activity.duration_seconds,
    distance_meters: activity.distance_meters,
    avg_pace: activity.avg_pace ? formatPace(activity.avg_pace) : null,
    avg_hr: activity.avg_heart_rate,
  };
}

function formatPace(paceSecondsPerKm: number): string {
  // Convert sec/km to min:sec/mi
  const pacePerMile = paceSecondsPerKm * 1.60934;
  const minutes = Math.floor(pacePerMile / 60);
  const seconds = Math.round(pacePerMile % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}/mi`;
}
