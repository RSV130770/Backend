(function(){
  const ACT = 'premifarm_activate';
  const ACK = 'premifarm_activate_ack';
  const CHANNEL = 'premifarm_channel';

  let allowed = true; // assume this tab is allowed unless proven otherwise

  function blockThisTab() {
    allowed = false;

    // Replace page content immediately to prevent UI loading
    document.open();
    document.write(`
      <h2 style="font-family:sans-serif; padding:20px;">
        Control panel is already open in another tab.<br><br>
        Please return to that tab.
      </h2>
    `);
    document.close();

    // IMPORTANT:
    // Do NOT attempt to close the tab.
    // Captive-click windows and user-opened tabs cannot be closed by JS.
  }

  function sendAck(session){
    const ack = { type: ACK, session, ts: Date.now() };

    // BroadcastChannel
    try {
      if ('BroadcastChannel' in window) {
        const bc = new BroadcastChannel(CHANNEL);
        bc.postMessage(ack);
        setTimeout(() => bc.close(), 150);
      }
    } catch(e){}

    // localStorage fallback
    try {
      localStorage.setItem(ACK, JSON.stringify(ack));
      setTimeout(() => localStorage.removeItem(ACK), 300);
    } catch(e){}

    // postMessage fallback
    try { window.postMessage(ack, location.origin); } catch(e){}
  }

  function handleActivation(msg){
    if (!msg || msg.type !== ACT) return;
    sendAck(msg.session);
    blockThisTab();
  }

  // --- Listen for activation requests ---
  window.addEventListener('message', ev => {
    if (ev.origin !== location.origin) return;
    handleActivation(ev.data);
  });

  if ('BroadcastChannel' in window) {
    const bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = ev => handleActivation(ev.data);
  }

  window.addEventListener('storage', ev => {
    if (ev.key === ACT && ev.newValue) {
      handleActivation(JSON.parse(ev.newValue));
    }
  });

  // --- Ask if another tab exists ---
  const session = Math.random().toString(36).slice(2);
  const act = { type: ACT, session, ts: Date.now() };

  // BroadcastChannel
  if ('BroadcastChannel' in window) {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage(act);
    setTimeout(() => bc.close(), 150);
  }

  // localStorage
  try {
    localStorage.setItem(ACT, JSON.stringify(act));
    setTimeout(() => localStorage.removeItem(ACT), 300);
  } catch(e){}

  // postMessage
  try { window.postMessage(act, location.origin); } catch(e){}

  // --- If no ACK received → allow page to load normally ---
  setTimeout(() => {
    if (!allowed) return;
    // UI loads normally
  }, 120);

})();

