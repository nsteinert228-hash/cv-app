// Shared auth UI logic used by both app.js and garminDashboard.js
import { signIn, signUp, signOut } from './auth.js';

export function createAuthUI() {
  const authUser = document.getElementById('authUser');
  const authBtn = document.getElementById('authBtn');
  const authModal = document.getElementById('authModal');
  const authModalTitle = document.getElementById('authModalTitle');
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');
  const authSubmit = document.getElementById('authSubmit');
  const authCancel = document.getElementById('authCancel');
  const authError = document.getElementById('authError');
  const authToggleText = document.getElementById('authToggleText');
  const authToggleLink = document.getElementById('authToggleLink');

  let authMode = 'signin';
  let currentUser = null;

  function updateAuthUI(user) {
    currentUser = user;
    if (user) {
      authUser.textContent = user.email;
      authBtn.textContent = 'Sign Out';
    } else {
      authUser.textContent = '';
      authBtn.textContent = 'Sign In';
    }
  }

  function showAuthModal() {
    authMode = 'signin';
    authModalTitle.textContent = 'Sign In';
    authSubmit.textContent = 'Sign In';
    authToggleText.textContent = "Don't have an account?";
    authToggleLink.textContent = 'Sign Up';
    authEmail.value = '';
    authPassword.value = '';
    authError.textContent = '';
    authModal.classList.add('visible');
  }

  function hideAuthModal() {
    authModal.classList.remove('visible');
    authError.textContent = '';
  }

  function getCurrentUser() {
    return currentUser;
  }

  // Wire up event listeners
  // onSignIn/onSignOut are callbacks the consumer provides
  function init({ onSignIn, onSignOut: onSignOutCb } = {}) {
    if (authBtn) {
      authBtn.addEventListener('click', async () => {
        if (currentUser) {
          try {
            await signOut();
            updateAuthUI(null);
            if (onSignOutCb) onSignOutCb();
          } catch (err) {
            console.warn('Sign out failed:', err.message);
          }
        } else {
          showAuthModal();
        }
      });
    }

    if (authCancel) authCancel.addEventListener('click', hideAuthModal);

    if (authModal) {
      authModal.addEventListener('click', (e) => {
        if (e.target === authModal) hideAuthModal();
      });
    }

    if (authToggleLink) {
      authToggleLink.addEventListener('click', () => {
        if (authMode === 'signin') {
          authMode = 'signup';
          authModalTitle.textContent = 'Sign Up';
          authSubmit.textContent = 'Sign Up';
          authToggleText.textContent = 'Already have an account?';
          authToggleLink.textContent = 'Sign In';
        } else {
          authMode = 'signin';
          authModalTitle.textContent = 'Sign In';
          authSubmit.textContent = 'Sign In';
          authToggleText.textContent = "Don't have an account?";
          authToggleLink.textContent = 'Sign Up';
        }
        authError.textContent = '';
      });
    }

    if (authSubmit) {
      authSubmit.addEventListener('click', async () => {
        const email = authEmail.value.trim();
        const password = authPassword.value;
        if (!email || !password) {
          authError.textContent = 'Please enter email and password.';
          return;
        }
        authError.textContent = '';
        authSubmit.disabled = true;
        try {
          if (authMode === 'signup') {
            await signUp(email, password);
            authError.style.color = 'var(--accent-dark)';
            authError.textContent = 'Check your email to confirm your account.';
            authSubmit.disabled = false;
            return;
          }
          const user = await signIn(email, password);
          updateAuthUI(user);
          hideAuthModal();
          if (onSignIn) onSignIn(user);
        } catch (err) {
          authError.style.color = '#ef4444';
          authError.textContent = err.message;
        }
        authSubmit.disabled = false;
      });
    }
  }

  return { updateAuthUI, showAuthModal, hideAuthModal, getCurrentUser, init };
}
