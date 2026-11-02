/* ============================================================
   SESSION WATCH
   - Keeps the control session alive while the user is actually using the
     page (a heartbeat is sent only after recent taps or key presses), so an
     idle user still times out after 5 minutes.
   - Detects that the session was lost (timed out, taken by another user)
     and stops the page instead of letting it send commands.
   - Checks immediately when the page becomes visible again, because a
     sleeping phone pauses all timers.
   Depends on: OFFLINE_MODE, appReady, currentPage (app.js),
               exitGuardLeaving (exitguard.js).
   ============================================================ */

const SESSION_CHECK_MS  = 15000;  // how often the page checks its session
const USER_ACTIVE_MS    = 60000;  // taps within this window count as activity

let sessionLost = false;
let lastUserActionMs = Date.now();

['pointerdown', 'keydown'].forEach(type =>
  document.addEventListener(type, () => { lastUserActionMs = Date.now(); }, true));

function showSessionLost() {
  if (sessionLost || OFFLINE_MODE) return;
  sessionLost = true;
  appReady = false;                  // block navigation and commands
  currentPage = 'lost';              // stops the dashboard polling loop
  exitGuardLeaving = true;           // no "leave site?" prompts from now on
  $('.modal.show').modal('hide');
  $('body').append(
    '<div class="exit-done">' +
    '<h5>Session ended</h5>' +
    '<p>Your control session has ended after a period of inactivity. ' +
    'Another user may be controlling the farm now.</p>' +
    '<a class="btn btn-primary" href="/">Reconnect</a>' +
    '</div>');
}

// The controller says this page no longer owns the session. If nobody else
// took it (the controller freed it because this page went quiet, e.g. the
// phone slept), quietly reload: loading the panel claims it again.
// Only when another phone holds it, show "Session ended".
let sessionRecheck = false;
function sessionGone() {
  if (sessionLost || sessionRecheck || OFFLINE_MODE) return;
  sessionRecheck = true;
  $.ajax({ url: '/api/session', dataType: 'json', timeout: 5000 })
    .done(d => {
      if (d && !d.busy) {
        exitGuardLeaving = true;       // no "leave site?" prompt for this reload
        location.reload();
      } else {
        showSessionLost();
      }
    })
    .fail(showSessionLost)
    .always(() => { sessionRecheck = false; });
}

// Any request rejected by the controller as "not your session"
$(document).ajaxError((event, xhr, settings) => {
  if (xhr.status === 403 && settings.url !== '/api/session') sessionGone();
});

// Session check. An active user sends a heartbeat (POST keeps the session
// alive), an idle user only asks (GET does not extend the session).
// It also runs while the page is hidden: the controller frees the session
// when the owner page is silent for 90 s (window closed without Leave), and
// this check is what tells it a background page is still there.
function checkSession() {
  if (sessionLost || OFFLINE_MODE || !appReady) return;

  const active = Date.now() - lastUserActionMs < USER_ACTIVE_MS;
  const request = active
    ? $.ajax({ url: '/api/ping', type: 'POST', dataType: 'json', timeout: 5000 })
    : $.ajax({ url: '/api/session', dataType: 'json', timeout: 5000 });

  request.done(d => {
    if (d && d.owner === false) sessionGone();
  });
  // Network errors (phone still reconnecting to Wi-Fi) are ignored:
  // the next check or a rejected command will tell.
}

setInterval(checkSession, SESSION_CHECK_MS);

// A sleeping phone pauses all timers. Check at once when the page comes back
// (screen unlocked, tab switched back, restored from history, Wi-Fi back),
// instead of showing stale data until the next scheduled check.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkSession();
});
window.addEventListener('pageshow', checkSession);
window.addEventListener('online', checkSession);
