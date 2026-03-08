# Deploy: Training Recommendations

Steps to get the training-recommendations feature live.

## 1. Run the database migration

Open the **Supabase Dashboard → SQL Editor** and run the contents of:

```
supabase/migrations/003_training_recommendations_cache.sql
```

This creates the `training_recommendations_cache` table and adds the
`training_preferences` column to `user_preferences`.

## 2. Set the ANTHROPIC_API_KEY secret

Using the Supabase CLI (or Dashboard → Edge Functions → Secrets):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

The edge function also needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`SUPABASE_ANON_KEY` — these are typically set automatically by Supabase.

## 3. Deploy the edge function

```bash
supabase functions deploy training-recommendations
```

Verify it's reachable:

```bash
curl -i https://zzmfhumffrvlfinpyrzc.supabase.co/functions/v1/training-recommendations
# Should return 401 (no auth) — confirms the function is live
```

## 4. Deploy frontend

The frontend deploys automatically to GitHub Pages on push to `master`.
Files served: `training.html`, `src/trainingDashboard.js`, `src/trainingData.js`.

## 5. Smoke test

1. Log in to the app
2. Navigate to the Training AI tab
3. Verify the readiness bar loads (sleep score, body battery, HRV, stress)
4. Click **Today** → confirm a workout recommendation renders
5. Click **This Week** → confirm a 7-day plan renders
6. Click **Training Plan** → confirm a multi-week program renders
7. Reload → confirm cached response loads instantly
8. Open preferences, save, regenerate → confirm new recommendation reflects preferences
