/* ============================================================
   SETTINGS PAGE
   Endpoints used:
     GET  /api/settings  -> { ap_ssid, ap_auth, sta_ssid, sta_saved, sta_connected }
     POST /api/settings  -> { ap_ssid?, ap_pass?, sta_ssid?, sta_pass? }
                        <- { status:"ok", restart:true }
     GET  /wifi/scan     -> { networks:[{ssid,rssi,security}] }
     POST /wifi/disconnect -> { status:"disconnected" }
   ============================================================ */

/* init (called once when page is first shown) */
function initSettings() {
  /* password eye toggles */
  document.getElementById("ap-pass-toggle").addEventListener("click", () =>
    _togglePass("ap-pass", "ap-pass-toggle"));
  document.getElementById("sta-pass-toggle").addEventListener("click", () =>
    _togglePass("sta-pass", "sta-pass-toggle"));

  /* scan button */
  document.getElementById("wifi-scan-btn").addEventListener("click", runWifiScan);

  /* disconnect button */
  document.getElementById("sta-disconnect-btn").addEventListener("click", staDisconnect);

  /* save button */
  document.getElementById("settings-save-btn").addEventListener("click", saveSettings);

  /* IP settings: automatic / manual */
  $("input[name=ip-mode]").on("change", () => { ipTouched = true; _applyIpMode(); });
  $(".ip-field").on("input", () => { ipTouched = true; });
}

/* Home network status, also followed while the farm is connecting */
let homeInfo = null;        // "home" object from the controller
let ipTouched = false;      // the user changed the IP settings
let homeTimer = null;

function _ipModeManual() { return $("#ip-mode-manual").is(":checked"); }

function _applyIpMode() {
  const manual = _ipModeManual();
  $(".ip-field").prop("disabled", !manual);
  $("#ip-mode-hint").text(t(manual ? "set.ip_manual_hint" : "set.ip_auto_hint"));
  if (manual && homeInfo) {
    // start from the saved manual values, else from what is in use now
    const m = homeInfo.manual || {};
    const put = (id, a, b) => { if (!$(id).val()) $(id).val(a || b || ""); };
    put("#ip-addr", m.ip, homeInfo.ip);
    put("#ip-mask", m.mask, homeInfo.mask);
    put("#ip-gw", m.gw, homeInfo.gw);
    put("#ip-dns1", m.dns1, homeInfo.dns1);
    put("#ip-dns2", m.dns2, homeInfo.dns2 !== "0.0.0.0" ? homeInfo.dns2 : "");
  }
}

function _showHome(h) {
  homeInfo = h || null;
  const box = $("#home-status");
  if (h && h.apIp) {
    $("#ap-address").text(h.apIp);
    $("#ap-moved-note").toggle(!!h.apMoved);
    $("#ap-address-line").show();
  }
  if (!h || h.state === "off") { box.hide(); _followHome(false); return; }

  // Texts are escaped first; the network name goes in as bold HTML
  const net = `<strong>${_esc(h.ssid || t("set.home_network"))}</strong>`;
  const th = (key, p) => {
    // t() with HTML values: escape the text, then put the values in
    let s = _esc(t(key));
    Object.keys(p || {}).forEach(k => { s = s.split("{" + k + "}").join(p[k]); });
    return s;
  };
  let html = "";
  if (h.state === "connected" && h.ip) {
    const url = "http://" + h.ip + "/";
    html = th("set.st_connected", { ssid: net }) + "<br>" + th("set.st_farm_at_home") + " " +
           `<a href="${url}" target="_blank" rel="noopener" class="font-weight-bold" id="home-link">${_esc(url)}</a>` +
           `<span class="text-muted d-block mt-1">` + th("set.st_open_from", { ssid: _esc(h.ssid || t("set.home_network")) }) +
           (h.hostname ? " · " + th("set.st_router_name", { name: _esc(h.hostname) }) : "") + `</span>`;
    if (h.kind === "dhcp") html += `<span class="d-block mt-1">` + th("set.st_router_address") + `</span>`;
  } else if (h.state === "retry") {
    const min = h.retryIn ? Math.max(1, Math.round(h.retryIn / 60)) : 0;
    html = th("set.st_not_connected", { ssid: net }) + (min ? " " + th("set.st_next_try", { min: min }) : "");
  } else {
    html = `<span class="spinner-border spinner-border-sm mr-1" role="status"></span>` +
           th("set.st_connecting", { ssid: net });
  }
  if (h.note) html += `<span class="d-block mt-1 text-warning-dark">${_esc(h.note)}</span>`;
  box.html(html).show();

  // IP settings reflect the controller unless the user is editing them
  if (!ipTouched) {
    const manual = h.mode === "manual";
    $("#ip-mode-manual").prop("checked", manual);
    $("#ip-mode-auto").prop("checked", !manual);
    const src = manual ? (h.manual || {}) : h;
    $("#ip-addr").val(src.ip || "");
    $("#ip-mask").val(src.mask || "");
    $("#ip-gw").val(src.gw || "");
    $("#ip-dns1").val(src.dns1 || "");
    $("#ip-dns2").val(src.dns2 && src.dns2 !== "0.0.0.0" ? src.dns2 : "");
    _applyIpMode();
  }
  const ip = h.ip || "";
  $("#ip-reserve-hint").text(ip && h.hostname
    ? t("set.st_reserve", { ip: ip, name: h.hostname }) : "")
    .toggle(!!(ip && h.hostname));

  _followHome(["connecting", "checking", "switching"].includes(h.state));
}

// Ask again every 3 s while the farm is joining the network
function _followHome(on) {
  if (!on) { clearTimeout(homeTimer); homeTimer = null; return; }
  if (homeTimer) return;
  homeTimer = setTimeout(() => {
    homeTimer = null;
    if (!$("#settings").is(":visible")) return;
    $.getJSON("/wifi/status").done(d => _showHome(d.home)).fail(() => _followHome(true));
  }, 3000);
}

/* run (called every time page becomes active) */
function runSettingsWorkflow() {
  _settingsStatus("", "");       // clear previous message
  loadSettingsData();
}

/* load current values from firmware */
function loadSettingsData() {
  if (OFFLINE_MODE) {
    /* fill demo values so UI is usable offline */
    document.getElementById("ap-ssid").value  = "MiniFarm-DEMO";
    document.getElementById("sta-ssid").value = "";
    _showStaSaved(false, false);
    return;
  }

  $.getJSON("/api/settings")
    .done(d => {
      document.getElementById("ap-ssid").value = d.ap_ssid || "";
      /* passwords are never returned - leave blank */
      document.getElementById("sta-ssid").value = d.sta_ssid || "";
      _showStaSaved(!!d.sta_saved, !!d.sta_connected);
      ipTouched = false;
      _showHome(d.home);
    })
    .fail(() => _settingsStatus("set.load_failed", "danger"));
}

/* wifi scan */
function runWifiScan() {
  const btn = document.getElementById("wifi-scan-btn");
  btn.disabled = true;
  btn.textContent = "…";
  document.getElementById("wifi-scan-results").style.display = "none";

  $.getJSON("/wifi/scan")
    .done(d => {
      const list = document.getElementById("wifi-scan-list");
      list.innerHTML = "";

      const nets = (d.networks || []).sort((a, b) => b.rssi - a.rssi);
      if (!nets.length) {
        list.innerHTML = '<span class="list-group-item text-muted">' + _esc(t("set.no_networks")) + '</span>';
      } else {
        nets.forEach(n => {
          const item = document.createElement("a");
          item.href = "#";
          item.className = "list-group-item list-group-item-action d-flex justify-content-between";
          const bars = _rssiBars(n.rssi);
          const lock = n.security !== "none" ? " 🔒" : "";
          item.innerHTML =
            `<span>${_esc(n.ssid)}${lock}</span>` +
            `<span class="text-muted small">${bars} ${n.rssi} dBm</span>`;
          item.addEventListener("click", e => {
            e.preventDefault();
            document.getElementById("sta-ssid").value = n.ssid;
            document.getElementById("wifi-scan-results").style.display = "none";
            document.getElementById("sta-pass").focus();
          });
          list.appendChild(item);
        });
      }
      document.getElementById("wifi-scan-results").style.display = "";
    })
    .fail(() => _settingsStatus("set.scan_failed", "danger"))
    .always(() => {
      btn.disabled = false;
      btn.textContent = t("set.scan");
    });
}

/* disconnect STA */
function staDisconnect() {
  if (!confirm(t("set.disconnect_q"))) return;

  $.ajax({ url: "/wifi/disconnect", type: "POST",
           contentType: "application/json", data: "{}" })
    .done(() => {
      document.getElementById("sta-ssid").value = "";
      document.getElementById("sta-pass").value = "";
      _showStaSaved(false, false);
      _settingsStatus("set.disconnected", "info");
    })
    .fail(() => _settingsStatus("set.disconnect_failed", "danger"));
}

/* save & restart */
function saveSettings() {
  const apSsid  = document.getElementById("ap-ssid").value.trim();
  const apPass  = document.getElementById("ap-pass").value;
  const staSsid = document.getElementById("sta-ssid").value.trim();
  const staPass = document.getElementById("sta-pass").value;

  /* basic validation */
  if (apSsid.length < 1) {
    return _settingsStatus("set.err_ap_name", "warning");
  }
  if (apPass.length > 0 && apPass.length < 8) {
    return _settingsStatus("set.err_ap_pass", "warning");
  }

  const payload = {};
  if (apSsid) payload.ap_ssid = apSsid;
  if (apPass) payload.ap_pass = apPass;
  if (staSsid) payload.sta_ssid = staSsid;
  if (staPass) payload.sta_pass = staPass;

  /* IP settings: sent when changed (the controller checks them too) */
  if (ipTouched) {
    if (_ipModeManual()) {
      const v = id => $(id).val().trim();
      const ipRe = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const ok = s => ipRe.test(s) && s.split(".").every(n => +n <= 255);
      const fields = [["#ip-addr", "set.address"], ["#ip-mask", "set.mask"], ["#ip-gw", "set.gateway"]];
      for (const [id, key] of fields) {
        if (!ok(v(id))) { $("#ip-settings").collapse("show"); $(id).trigger("focus");
          return _settingsStatus("set.err_ip", "warning", { field: t(key), example: $(id).attr("placeholder") }); }
      }
      for (const [id, key] of [["#ip-dns1", "set.dns1"], ["#ip-dns2", "set.dns2"]]) {
        if (v(id) && !ok(v(id))) { $("#ip-settings").collapse("show"); $(id).trigger("focus");
          return _settingsStatus("set.err_ip_optional", "warning", { field: t(key) }); }
      }
      payload.ip = { mode: "manual", ip: v("#ip-addr"), mask: v("#ip-mask"), gw: v("#ip-gw"),
                     dns1: v("#ip-dns1"), dns2: v("#ip-dns2") };
    } else {
      payload.ip = { mode: "auto" };
    }
  }

  const btn = document.getElementById("settings-save-btn");
  btn.disabled = true;
  btn.textContent = t("set.saving");
  _settingsStatus("", "");

  if (OFFLINE_MODE) {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = t("set.save_restart");
      _settingsStatus("set.offline_not_sent", "warning");
    }, 600);
    return;
  }

  $.ajax({
    url: "/api/settings",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload)
  })
  .done(resp => {
    if (resp && resp.restart) {
      _settingsStatus("set.saved_restart", "success");
      btn.textContent = t("set.restarting");
    } else {
      _settingsStatus("set.saved", "success");
      btn.disabled = false;
      btn.textContent = t("set.save_restart");
    }
  })
  .fail(xhr => {
    // The controller's own error text is shown as it comes
    const err = xhr.responseJSON && xhr.responseJSON.error;
    if (err) _settingsStatusText(err, "danger"); else _settingsStatus("set.save_failed", "danger");
    btn.disabled = false;
    btn.textContent = t("set.save_restart");
  });
}

/* private helpers */
function _togglePass(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (inp.type === "password") {
    inp.type = "text";
    btn.textContent = "🙈";
  } else {
    inp.type = "password";
    btn.textContent = "👁";
  }
}

let staBadge = { saved: false, connected: false };   // redrawn on language change

function _showStaSaved(saved, connected) {
  staBadge = { saved: saved, connected: connected };
  const badge = document.getElementById("sta-saved-badge");
  const disconnRow = document.getElementById("sta-disconnect-row");
  if (saved) {
    badge.style.removeProperty("display");
    badge.textContent = t(connected ? "set.badge_connected" : "set.badge_saved");
    badge.className = connected ? "badge badge-success" : "badge badge-secondary";
    disconnRow.style.display = "";
  } else {
    badge.style.setProperty("display", "none", "important");
    disconnRow.style.display = "none";
  }
}

// Status line: a text key (+ placeholder values), redrawn on language
// change; "" hides it
let settingsStatus = null;
function _settingsStatus(key, type, params) {
  settingsStatus = key ? { key: key, type: type, params: params } : null;
  _showSettingsStatus(key ? t(key, params) : "", type);
}
// A text that is not in local.json (an error from the controller)
function _settingsStatusText(msg, type) {
  settingsStatus = null;
  _showSettingsStatus(msg, type);
}
function _showSettingsStatus(msg, type) {
  const el = document.getElementById("settings-status");
  if (!msg) { el.style.display = "none"; return; }
  el.className = "alert alert-" + type;
  el.textContent = msg;
  el.style.display = "";
}

// Language changed: redraw what this screen built in JS
onLanguageChange(() => {
  if (!initialized.settings) return;
  _applyIpMode();
  if (homeInfo) _showHome(homeInfo);
  _showStaSaved(staBadge.saved, staBadge.connected);
  if (settingsStatus) _showSettingsStatus(t(settingsStatus.key, settingsStatus.params), settingsStatus.type);
});

function _rssiBars(rssi) {
  if (rssi >= -55) return "▂▄▆█";
  if (rssi >= -65) return "▂▄▆_";
  if (rssi >= -75) return "▂▄__";
  return "▂___";
}

function _esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
