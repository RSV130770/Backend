/* ============================================================
LOADER
 ============================================================ */


(function(){
  const ACT = 'premifarm_activate';
  const ACK = 'premifarm_activate_ack';
  const CHANNEL = 'premifarm_channel';

  let allowed = true; // assume allowed until proven otherwise

  function activateExistingTab() {
    allowed = false;
    document.write("<h2 style='font-family:sans-serif'>Control panel is already open in another tab.</h2>");
    document.close();
  }

  function sendAck(session){
    const ack = { type: ACK, session, ts: Date.now() };

    // BroadcastChannel
    try {
      if ('BroadcastChannel' in window) {
        const bc = new BroadcastChannel(CHANNEL);
        bc.postMessage(ack);
        setTimeout(() => bc.close(), 200);
      }
    } catch(e){}

    // localStorage
    try {
      localStorage.setItem(ACK, JSON.stringify(ack));
      setTimeout(() => localStorage.removeItem(ACK), 500);
    } catch(e){}

    // postMessage
    try { window.postMessage(ack, location.origin); } catch(e){}
  }

  function handle(msg){
    if (!msg || msg.type !== ACT) return;
    sendAck(msg.session);
    activateExistingTab();
  }

  // Listen for activation requests
  window.addEventListener('message', ev => {
    if (ev.origin !== location.origin) return;
    handle(ev.data);
  });

  if ('BroadcastChannel' in window) {
    const bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = ev => handle(ev.data);
  }

  window.addEventListener('storage', ev => {
    if (ev.key === ACT && ev.newValue) {
      handle(JSON.parse(ev.newValue));
    }
  });

  // Ask if another tab exists
  const session = Math.random().toString(36).slice(2);
  const act = { type: ACT, session, ts: Date.now() };

  // BroadcastChannel
  if ('BroadcastChannel' in window) {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage(act);
    setTimeout(() => bc.close(), 200);
  }

  // localStorage
  try {
    localStorage.setItem(ACT, JSON.stringify(act));
    setTimeout(() => localStorage.removeItem(ACT), 500);
  } catch(e){}

  // postMessage
  try { window.postMessage(act, location.origin); } catch(e){}

  // If no ACK received within 150ms → we are the only tab
  setTimeout(() => {
    if (!allowed) return;
    // allow page to continue loading normally
  }, 150);

})();
