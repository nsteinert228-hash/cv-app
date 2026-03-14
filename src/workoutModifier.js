// Workout Modifier — single-prompt AI workout modification for current day
import { modifyWorkout } from './seasonData.js';

let _container = null;
let _workout = null;
let _season = null;
let _callbacks = null;

// ── Public API ──────────────────────────────────────────────

export function initWorkoutModifier(container, workout, season, callbacks) {
  _container = container;
  _workout = workout;
  _season = season;
  _callbacks = callbacks;
  render();
}

export function destroyWorkoutModifier() {
  if (_container) _container.innerHTML = '';
  _container = null;
  _workout = null;
  _season = null;
}

// ── Render ──────────────────────────────────────────────────

function render() {
  if (!_container) return;

  _container.innerHTML = `
    <div class="wm-container">
      <div class="wm-label">Modify Today's Workout</div>
      <div class="wm-input-row">
        <input type="text" class="wm-input" id="wmInput"
               placeholder="e.g., swap the run for a bike ride, make it a recovery day..."
               autocomplete="off">
        <button class="btn-primary wm-submit" id="wmSubmit">Update</button>
      </div>
      <div class="wm-status" id="wmStatus"></div>
      <div class="wm-undo" id="wmUndo" style="display:none">
        <button class="btn-ghost" id="wmUndoBtn">Undo change</button>
      </div>
    </div>
  `;

  const input = document.getElementById('wmInput');
  const submitBtn = document.getElementById('wmSubmit');

  submitBtn.addEventListener('click', () => handleSubmit());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmit();
  });
}

async function handleSubmit() {
  const input = document.getElementById('wmInput');
  const submitBtn = document.getElementById('wmSubmit');
  const status = document.getElementById('wmStatus');
  const undoEl = document.getElementById('wmUndo');

  const prompt = input.value.trim();
  if (!prompt) return;

  input.disabled = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Updating...';
  status.textContent = 'AI is modifying your workout...';
  status.className = 'wm-status loading';

  try {
    const result = await modifyWorkout(_workout.id, prompt, _season.id);

    status.textContent = 'Workout updated! Refreshing...';
    status.className = 'wm-status success';
    input.value = '';

    // Show undo option
    if (result.original_workout) {
      undoEl.style.display = '';
      const undoBtn = document.getElementById('wmUndoBtn');
      undoBtn.addEventListener('click', async () => {
        undoBtn.disabled = true;
        undoBtn.textContent = 'Reverting...';
        try {
          await modifyWorkout(_workout.id, '__UNDO__', _season.id);
          undoEl.style.display = 'none';
          _callbacks?.onWorkoutUpdated?.();
        } catch (err) {
          undoBtn.textContent = `Undo failed: ${err.message}`;
          undoBtn.disabled = false;
        }
      }, { once: true });
    }

    // Notify parent to refresh
    setTimeout(() => {
      _callbacks?.onWorkoutUpdated?.();
    }, 500);
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
    status.className = 'wm-status error';
    input.disabled = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Update';
  }
}
