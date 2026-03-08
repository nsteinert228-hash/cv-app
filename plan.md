# Plan: Test & Deploy Training Recommendations

## Context
The training recommendations feature has three pieces already built:
- **Edge function** (`training-recommendations/index.ts`) — calls Claude API with Garmin health data
- **Client data layer** (`src/trainingData.js`) — calls the edge function from the frontend
- **DB migration** (`003_training_recommendations_cache.sql`) — cache table + preferences column

The frontend (GitHub Pages), Garmin edge functions, and sync cron are all already deployed. We need to get the training recommendations feature deployed and tested.

---

## Step 1: Run the database migration
- Apply `supabase/migrations/003_training_recommendations_cache.sql` to the Supabase project
- This creates the `training_recommendations_cache` table and adds the `training_preferences` column
- **How**: Run the SQL via the Supabase dashboard SQL editor (manual step — we'll provide the instructions)

## Step 2: Set the `ANTHROPIC_API_KEY` secret on Supabase
- The edge function reads `ANTHROPIC_API_KEY` from environment
- Set it via: `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
- **Note**: Requires the Supabase CLI authenticated to the project, or can be done via the dashboard

## Step 3: Deploy the training-recommendations edge function
- Deploy via: `supabase functions deploy training-recommendations`
- Verify the function appears in the Supabase dashboard under Edge Functions
- Confirm it's reachable at `https://zzmfhumffrvlfinpyrzc.supabase.co/functions/v1/training-recommendations`

## Step 4: Add frontend tests for the training data layer
- Add `tests/trainingData.test.js` covering:
  - `getTrainingRecommendation()` — mocks fetch, verifies correct URL/headers/body
  - `getTodayReadiness()` — mocks Garmin helpers, verifies snapshot shape
  - `getRecentWorkouts()` — mocks Supabase, verifies aggregation logic
  - `getTrainingPreferences()` / `saveTrainingPreferences()` — mocks Supabase CRUD
- Run with `npm test` to confirm all pass

## Step 5: Push frontend to GitHub Pages
- The `training.html` and `src/trainingDashboard.js` files are already committed but need to land on `master` to trigger the deploy workflow
- Once merged, GitHub Pages serves the Training AI tab automatically

## Step 6: End-to-end smoke test (manual — document steps)
- Add a short section to the README or a `TESTING.md` with manual E2E test steps:
  1. Log in to the app
  2. Navigate to Training AI tab
  3. Verify readiness bar loads (sleep score, body battery, HRV)
  4. Click "Today" view → confirm a workout recommendation renders
  5. Click "This Week" → confirm 7-day plan renders
  6. Click "Training Plan" → confirm multi-week program renders
  7. Reload page → confirm cached response loads instantly (check `_cached: true`)
  8. Open preferences, save changes, regenerate → confirm new recommendation reflects preferences
