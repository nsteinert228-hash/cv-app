import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { period = "all" } = await req.json().catch(() => ({}));

    // Build date filter
    let dateFilter: string | null = null;
    const now = new Date();
    if (period === "week") {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      dateFilter = weekAgo.toISOString();
    } else if (period === "month") {
      const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      dateFilter = monthAgo.toISOString();
    } else if (period === "year") {
      const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      dateFilter = yearAgo.toISOString();
    }

    let query = supabase
      .from("murph_attempts")
      .select(`
        id,
        user_id,
        total_time_seconds,
        mile1_time_seconds,
        mile2_time_seconds,
        mile1_avg_pace,
        mile2_avg_pace,
        mile1_avg_hr,
        mile2_avg_hr,
        pullups_completed,
        pushups_completed,
        squats_completed,
        status,
        finished_at,
        created_at
      `)
      .eq("submitted_to_leaderboard", true)
      .in("status", ["completed", "verified"])
      .order("total_time_seconds", { ascending: true });

    if (dateFilter) {
      query = query.gte("finished_at", dateFilter);
    }

    const { data: attempts, error } = await query;
    if (error) throw error;

    if (!attempts || attempts.length === 0) {
      return new Response(
        JSON.stringify({ entries: [], total: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch display names for all users
    const userIds = [...new Set(attempts.map((a: any) => a.user_id))];
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);

    const profileMap: Record<string, string> = {};
    if (profiles) {
      for (const p of profiles) {
        profileMap[p.user_id] = p.display_name;
      }
    }

    // Build ranked entries
    const entries = attempts.map((a: any, i: number) => ({
      rank: i + 1,
      attempt_id: a.id,
      user_id: a.user_id,
      display_name: profileMap[a.user_id] || "Anonymous",
      total_time_seconds: a.total_time_seconds,
      total_time_formatted: formatTime(a.total_time_seconds),
      mile1_time_formatted: a.mile1_time_seconds ? formatTime(a.mile1_time_seconds) : null,
      mile2_time_formatted: a.mile2_time_seconds ? formatTime(a.mile2_time_seconds) : null,
      mile1_avg_pace: a.mile1_avg_pace,
      mile2_avg_pace: a.mile2_avg_pace,
      mile1_avg_hr: a.mile1_avg_hr,
      mile2_avg_hr: a.mile2_avg_hr,
      pullups: a.pullups_completed,
      pushups: a.pushups_completed,
      squats: a.squats_completed,
      verified: a.status === "verified",
      date: a.finished_at,
    }));

    return new Response(
      JSON.stringify({ entries, total: entries.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("murph-leaderboard error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
