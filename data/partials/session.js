/* ============================================================
   SESSION WATCH
   - Keeps the control session alive while the user is actually using the
     page (a heartbeat is sent only if there was a tap or key press since
     the last check), so an idle user times out after about 1 minute.
     A Playground pause then ends on the controller.
   - Detects that the session was lost (timed out, taken by another user)
     and stops the page instead of letting it send commands.
   - Checks immediately when the page becomes visible again, because a
     sleeping phone pauses all timers.
   Depends on: OFFLINE_MODE, appReady, currentPage (app.js),
               exitGuardLeaving (exitguard.js).
   ============================================================ */

const SESSION_CHECK_MS  = 15000;  // how often the page checks its session

let sessionLost = false;
let userActedSinceCheck = false;  // a tap or key press since the last check

['pointerdown', 'keydown'].forEach(type =>
  document.addEventListener(type, () => { userActedSinceCheck = true; }, true));

function showSessionLost() {
  if (sessionLost || OFFLINE_MODE) return;
  sessionLost = true;
  appReady = false;                  // block navigation and commands
  currentPage = 'lost';              // stops the dashboard polling loop
  exitGuardLeaving = true;           // no "leave site?" prompts from now on
  $('.modal.show').modal('hide');
  const $box = $('<div class="exit-done"><h5></h5><p></p><a class="btn btn-primary" href="/"></a></div>');
  $box.find('h5').text(t('sess.ended'));
  $box.find('p').text(t('sess.ended_text'));
  $box.find('a').text(t('sess.reconnect'));
  $('body').append($box);
}

// The controller says this page no longer owns the session. If it ended by
// the idle timeout, or another phone holds it now, show "Session ended".
// If nobody took it (the controller freed it because this page went quiet,
// e.g. the phone slept), quietly reload: loading the panel claims it again.
let sessionRecheck = false;
function sessionGone() {
  if (sessionLost || sessionRecheck || OFFLINE_MODE) return;
  sessionRecheck = true;
  $.ajax({ url: '/api/session', dataType: 'json', timeout: 5000 })
    .done(d => {
      if (d && !d.busy && !d.expired) {
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
// when the owner page is silent for 35 s (window closed without Leave), and
// this check is what tells it a background page is still there.
function checkSession() {
  if (sessionLost || OFFLINE_MODE || !appReady) return;

  const active = userActedSinceCheck;
  userActedSinceCheck = false;
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
