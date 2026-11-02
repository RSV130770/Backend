/* ============================================================
   EXIT GUARD
   Keeps a back gesture / back button inside the app:
     - closes an open dialog first,
     - otherwise steps back one screen (Settings -> Playground -> ...),
     - on Dashboard asks for confirmation before leaving.
   Also blocks pull-to-refresh and reload/close without confirmation
   (browsers show their own wording for the latter).
   Depends on: showPage, current, currentPage, pageOrder, appReady (app.js).
   ============================================================ */

// How the guard works
// The app adds one extra history entry (same URL) above its own entry. Back
// then only removes that entry and fires 'popstate', which the app turns into
// "close dialog / previous screen / ask before leaving".
//
// Chrome skips history entries a page adds without a fresh user gesture, and
// it wants a new gesture for every entry. So the entry is added only during a
// tap, swipe or key press, one per gesture. After Back has used it, the next
// touch adds it again.

let exitGuardArmed = false;   // a guard entry is above the app's own entry
let exitGuardLeaving = false; // user confirmed leaving: stop intercepting

// The page is being touched/typed in right now (Chrome: transient activation)
function userIsInteracting() {
  return navigator.userActivation ? navigator.userActivation.isActive : true;
}

// Number of guard entries at and below the current one (0 or 1)
function guardDepth() {
  const st = history.state;
  return (st && st.spaGuard) ? 1 : 0;
}

function armExitGuard() {
  if (exitGuardArmed || exitGuardLeaving || !userIsInteracting()) return;
  history.pushState({ spaGuard: true }, '');
  exitGuardArmed = true;
}

// Every finished tap, swipe or key press re-arms the guard if Back used it.
// These events fire after the gesture ends, so this never interferes with
// focusing a text field or opening the on-screen keyboard.
const EXIT_GUARD_ARM_EVENTS = ['click', 'keyup', 'touchend', 'pointerup'];

function armExitGuardOnInteraction() {
  EXIT_GUARD_ARM_EVENTS.forEach(t =>
    document.addEventListener(t, armExitGuard, { capture: true, passive: true }));
}

window.addEventListener('popstate', () => {
  if (exitGuardLeaving) return;
  exitGuardArmed = guardDepth() > 0;   // Back has just used the guard entry

  // 1. An open dialog: Back closes it
  const $openModal = $('.modal.show');
  if ($openModal.length) {
    $openModal.modal('hide');          // on the exit dialog this means "Stay"
    return;
  }

  // 2. Not on the first screen: Back goes one screen back
  if (appReady && current > 0) {
    showPage(pageOrder[current - 1]);
    return;
  }

  // 3. On Dashboard: ask before leaving
  showExitDialog();
});

function showExitDialog() {
  $('#exitModal').modal({ backdrop: 'static', keyboard: true });
  $('#exitModal').modal('show');
}

function leaveApp() {
  exitGuardLeaving = true;
  appReady = false;             // block navigation
  currentPage = 'exit';         // stops the dashboard polling loop
  $('#exitModal').modal('hide');

  // Release the control session FIRST and wait for the controller's answer.
  // A request fired while the page is already navigating away can be dropped,
  // and then the next visit sees "busy" until the 5-minute timeout.
  if (OFFLINE_MODE) {
    finishLeaving();
    return;
  }
  $.ajax({ url: '/api/release', type: 'POST', timeout: 2000 })
    .always(finishLeaving);
}

function finishLeaving() {
  // Leave to the previous site if there is one; a captive-portal window or a
  // directly opened tab has nowhere to go back to, so show a final message.
  // Skip all guard entries and the app's own entry in one step.
  history.go(-(guardDepth() + 1));
  setTimeout(() => {
    $('body').append(
      '<div class="exit-done">' +
      '<h5>Session closed</h5>' +
      '<p>You can close this window now.</p>' +
      '<a class="btn btn-primary" href="/">Open control panel again</a>' +
      '</div>');
  }, 400);
}

// The page is going away without the Leave button (Back before any tap,
// the captive-portal window closed, the tab closed). Release the control
// session anyway, or the next visit shows "busy" until the 5-minute timeout.
// sendBeacon is the one request browsers still deliver while unloading.
window.addEventListener('pagehide', () => {
  if (exitGuardLeaving || OFFLINE_MODE || !navigator.sendBeacon) return;
  navigator.sendBeacon('/api/release');
});

// Pull-to-refresh: some browsers (e.g. Mi Browser) ignore the CSS rule
// "overscroll-behavior: none" and reload the page when it is pulled down at
// the top. Cancel exactly that gesture: a mostly downward drag while the page
// (and any scroll box under the finger) is already at its top.
let ptrStartX = 0, ptrStartY = 0;
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  ptrStartX = e.touches[0].clientX;
  ptrStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (e.touches.length !== 1 || !e.cancelable) return;
  const dx = e.touches[0].clientX - ptrStartX;
  const dy = e.touches[0].clientY - ptrStartY;
  if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) return;   // up, or sideways swipe
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  // A scroll box under the finger that can still scroll up handles the drag
  for (let el = e.target; el && el !== document.body && el.nodeType === 1; el = el.parentElement) {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return;
  }
  const page = document.scrollingElement || document.documentElement;
  if (page.scrollTop <= 0) e.preventDefault();
}, { passive: false });

// Reload, closing the tab or typing another address
window.addEventListener('beforeunload', e => {
  if (exitGuardLeaving || !appReady) return;
  e.preventDefault();
  e.returnValue = '';                  // required by Chrome to show the prompt
});

document.addEventListener('DOMContentLoaded', () => {
  armExitGuardOnInteraction();

  $('#exit-stay-btn').on('click', () => {
    $('#exitModal').modal('hide');
  });
  $('#exit-leave-btn').on('click', leaveApp);

  // Whenever the exit dialog closes without leaving, put the guard back
  $('#exitModal').on('hidden.bs.modal', () => {
    if (!exitGuardLeaving) armExitGuard();
  });
  $('#exitModal').on('shown.bs.modal', disableSwipe);
  $('#exitModal').on('hidden.bs.modal', enableSwipe);
});
