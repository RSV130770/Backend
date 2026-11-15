/* ============================================================
   DEMO CONTROLLER (demo/demo.js)
   ============================================================
   Loaded by system.js only when /api/ping does not answer, i.e. when
   the web app is served without a controller (for example from a web
   host). It answers the controller's REST routes inside the browser,
   so the whole interface works with sample data:
   - the outputs of the THS3 prototype,
   - two tasks: the built-in template "Default" and "Basil",
   - sensor values that change slowly,
   - task control, stage change, schedule editing, manual control.
   Nothing leaves the browser; changes live until the page is reloaded.

   The routes and answers follow the firmware (site.cpp, tasks.cpp,
   outputs.cpp, sensors.cpp, playground.cpp, homenet.cpp).
   Not needed on the controller: the folder demo/ is not uploaded.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- outputs (outputs.cpp) ---------- */
  // id, label, mode, icon, style, invert, rampDefault
  const OUT = [
    [0, "White Light", "analog_ramp", "/sun.svg", "background-color:lightgray;", false, 2000],
    [1, "Red Light", "analog_ramp", "/sun.svg", "background-color:#ff4d4d;", true, 2000],
    [2, "Blue Light", "analog_ramp", "/sun.svg", "background-color:#4738ce;", true, 2000],
    [3, "UV Light", "analog_ramp", "/sun.svg", "background-color:#b543fb;", true, 2000],
    [4, "Far Red", "analog_ramp", "/sun.svg", "background-color:#720101;", true, 2000],
    [5, "Pump", "softstart", "/shower.svg", "background-color:#C7C7F1;", false, 0],
    [6, "Mist", "no_ramp", "/mist.svg", "background-color:#C7C7F1;", false, 0],
    [7, "Fan", "analog_ramp", "/fan.svg", "background-color:#C7C7F1;", false, 0],
    [8, "AUX", "analog_ramp", "/aux.svg", "background-color:#C7C7F1;", false, 0],
    [9, "Message", "message", "/message.svg", "background-color:#FFE7A3;", false, 0],
    [10, "Sound", "sound", "/sound.svg", "background-color:#C9F2D9;", false, 0]
  ];
  const WHITE = 0, RED = 1, BLUE = 2, UV = 3, FARR = 4, PUMP = 5, MIST = 6, FAN = 7, MESSAGE = 9, SOUND = 10;

  /* ---------- template task (tasks.cpp buildTemplateJson) ---------- */
  const PCT = 50, RAMP = 120000;

  function ev(stage, group, gname, ch, rep, tm, pct, rise, fall, on, off) {
    return { stageId: stage, groupId: group, groupName: gname, channelId: ch, repeat: rep,
             time: tm, afterDays: 0, expireAfterDays: 0, duty: pct, rise: rise, fall: fall,
             on: on, off: off, enabled: true };
  }

  function template() {
    const stages = [
      { id: 1, name: "Germination", days: 4, hours: 0, endPause: true, message: "Remove the covers" },
      { id: 2, name: "Seedling", days: 7, hours: 0, endPause: false, message: "" },
      { id: 3, name: "Growth", days: 21, hours: 0, endPause: false, message: "" },
      { id: 4, name: "Flowering", days: 28, hours: 0, endPause: true, message: "Check the plants before finishing" },
      { id: 5, name: "Finishing", days: 0, hours: 0, endPause: false, message: "" }
    ];
    const s = [];
    let g = 0;
    const lights = (stage, name, chans, on, off) => {
      g++;
      chans.forEach(c => {
        s.push(ev(stage, g, name, c, "daily", on, PCT, RAMP, RAMP, 0, 0));
        s.push(ev(stage, g, name, c, "daily", off, 0, RAMP, RAMP, 0, 0));
      });
    };
    const cycle = (stage, name, ch, on, off) => {
      g++;
      s.push(ev(stage, g, name, ch, "custom", "--:--", 100, ch === PUMP ? 500 : 0, 0, on, off));
    };
    const steady = (stage, name, ch) => {
      g++;
      s.push(ev(stage, g, name, ch, "once", "00:00", PCT, RAMP, 0, 0, 0));
    };
    const wbr = [WHITE, BLUE, RED], wrb = [WHITE, RED, BLUE];
    const allc = [WHITE, RED, BLUE, UV, FARR];
    cycle(1, "Pump", PUMP, 10, 3600); cycle(1, "Mist", MIST, 30, 1800);
    lights(2, "Light", wbr, "06:00", "22:00"); cycle(2, "Pump", PUMP, 10, 3600); steady(2, "Fan", FAN);
    lights(3, "Light", wbr, "06:00", "22:00"); lights(3, "UV", [UV], "10:00", "12:00");
    cycle(3, "Pump", PUMP, 10, 2700); steady(3, "Fan", FAN);
    lights(4, "Light", wrb, "08:00", "20:00"); lights(4, "Far-red", [FARR], "20:00", "20:15");
    cycle(4, "Pump", PUMP, 10, 2700); steady(4, "Fan", FAN);
    lights(5, "Light", allc, "06:30", "22:30"); cycle(5, "Pump", PUMP, 10, 3600);
    g++;
    const m = ev(5, g, "Harvest", MESSAGE, "once", "09:00", 100, 0, 0, 0, 0);
    m.message = "Ready to harvest";
    s.push(m);
    const snd = ev(5, g, "Harvest", SOUND, "once", "09:00", PCT, 0, 0, 0, 0);
    snd.sound = "stage.wav";
    s.push(snd);
    return { id: 0, name: "Default", builtIn: true, stages: stages, schedule: s };
  }

  /* ---------- the user's own task, in the interface language ---------- */
  const OWN = {
    ru: { "Default": "Базилик", "Germination": "Проращивание", "Seedling": "Рассада", "Growth": "Рост",
          "Flowering": "Цветение", "Finishing": "Дозревание", "Remove the covers": "Снимите крышки",
          "Check the plants before finishing": "Проверьте растения перед дозреванием",
          "Ready to harvest": "Можно собирать урожай", "Light": "Свет", "UV": "УФ",
          "Far-red": "Дальний красный", "Pump": "Насос", "Mist": "Туман", "Fan": "Вентилятор",
          "Harvest": "Урожай" },
    et: { "Default": "Basiilik", "Germination": "Idandamine", "Seedling": "Istikud", "Growth": "Kasv",
          "Flowering": "Õitsemine", "Finishing": "Valmimine", "Remove the covers": "Eemaldage katted",
          "Check the plants before finishing": "Kontrollige taimi enne valmimist",
          "Ready to harvest": "Saak on valmis", "Light": "Valgus", "UV": "UV",
          "Far-red": "Kaugpunane", "Pump": "Pump", "Mist": "Udu", "Fan": "Ventilaator",
          "Harvest": "Saak" },
    en: { "Default": "Basil" }
  };

  function ownTask(lang) {
    const tr = OWN[lang] || OWN.en;
    const t = JSON.parse(JSON.stringify(template()));
    const pick = x => tr[x] || x;
    t.id = 1; t.builtIn = false; t.name = pick("Default");
    t.stages.forEach(x => { x.name = pick(x.name); if (x.message) x.message = pick(x.message); });
    t.schedule.forEach(e => {
      e.groupName = pick(e.groupName);
      if (e.message) e.message = pick(e.message);
    });
    return t;
  }

  /* ---------- controller state ---------- */
  const lang0 = (typeof I18N !== "undefined" && I18N.lang) || "en";
  const now0 = Date.now();
  const S = {
    presets: { 0: template(), 1: ownTask(lang0) },
    presetId: 1,
    status: "running",                          // the demo opens with a running task
    start: now0 - (7 * 24 + 5) * 3600 * 1000,   // started 7 days 5 hours ago
    stageIdx: 1,                                // stage 2 of 5
    stageStart: now0 - (3 * 24 + 5) * 3600 * 1000,
    lang: "",
    notice: null
  };

  const pad = n => String(n).padStart(2, "0");
  function fmtStart() {
    if (S.status === "stopped" || !S.start) return "";
    const d = new Date(S.start);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const active = () => ["running", "paused", "frozen"].includes(S.status);
  const curStages = () => S.presets[S.presetId].stages;

  /* ---------- outputs now (value and seconds to the next change) ---------- */
  function hm(s) { const p = String(s).split(":"); return (+p[0]) * 60 + (+p[1]); }

  function channelNow(ch, events, secOfDay) {
    let value = 0, next = 0;
    const daily = events.filter(e => e.repeat === "daily" && /^\d\d:\d\d$/.test(e.time))
      .map(e => ({ t: hm(e.time) * 60, v: +e.duty })).sort((a, b) => a.t - b.t);
    if (daily.length) {
      let cur = daily[daily.length - 1], nxt = daily[0];
      for (let i = 0; i < daily.length; i++) {
        if (daily[i].t <= secOfDay) { cur = daily[i]; nxt = daily[(i + 1) % daily.length]; }
      }
      value = cur.v;
      next = (nxt.t - secOfDay + 86400) % 86400 || 86400;
    }
    events.filter(e => e.repeat === "custom" && (e.on > 0 || e.off > 0)).forEach(e => {
      const period = e.on + e.off, ph = Math.floor(Date.now() / 1000) % period;
      if (ph < e.on) { value = +e.duty; next = e.on - ph; } else { next = period - ph; }
    });
    events.filter(e => e.repeat === "once" && ch !== MESSAGE && ch !== SOUND).forEach(e => {
      value = +e.duty; next = 0;
    });
    return { value: value, next: next };
  }

  function outputsNow() {
    const d = new Date();
    const sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    const sid = active() ? curStages()[S.stageIdx].id : null;
    return OUT.map(o => {
      let v = { value: 0, next: 0 };
      if (S.status === "running") {
        const evs = S.presets[S.presetId].schedule.filter(e => e.stageId === sid && e.channelId === o[0] && e.enabled !== false);
        v = channelNow(o[0], evs, sec);
      }
      return { idx: o[0], value: v.value, next: v.next };
    });
  }

  // sensors.cpp fillDashboardState: slow, small changes around plausible values
  function sensors(r) {
    const t = Date.now() / 1000;
    const d = new Date();
    r.rtc = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    r.w_temp = (21.5 + 0.3 * Math.sin(t / 600)).toFixed(1);
    r.a_temp = (24.0 + 0.6 * Math.sin(t / 900 + 1)).toFixed(1);
    r.a_hum = (55 + 3 * Math.sin(t / 700 + 2)).toFixed(1);
    r.Level = "OK";
    r.outputs = outputsNow();
  }

  function stageState(r) {
    if (!active()) return;
    const st = curStages(), cur = st[S.stageIdx];
    r.stage = { id: cur.id, index: S.stageIdx, count: st.length, name: cur.name,
                elapsedMin: Math.floor((Date.now() - S.stageStart) / 60000),
                lengthMin: (cur.days * 24 + cur.hours) * 60 };
    r.stages = st.map(x => ({ id: x.id, name: x.name }));
  }

  /* ---------- REST routes ---------- */
  const ok = (body, code) => ({ code: code || 200, body: body });

  function handle(method, path, q, d) {
    if (method === "GET") {
      switch (path) {
        case "/api/ping": return ok({ status: "ok" });
        case "/api/session": return ok({ busy: true, remainSec: 300, owner: true, expired: false });
        case "/api/lang": return ok({ lang: S.lang });
        case "/api/outputs":
          return ok({ outputs: OUT.map(o => ({ id: o[0], label: o[1], mode: o[2], icon: o[3], style: o[4],
            invert: o[5], rampDefault: o[6], remaining: 0, supportsDuty: !["no_ramp", "message"].includes(o[2]),
            supportsRamp: o[2] === "analog_ramp", supportsSoftstart: o[2] === "softstart" })) });
        case "/api/state": {
          const r = {};
          sensors(r);
          r.taskStatus = S.status;
          stageState(r);
          if (S.status === "frozen") r.pauseMessage = curStages()[S.stageIdx].message;
          if (S.notice) r.notice = S.notice;
          return ok(r);
        }
        case "/preset/list":
          return ok({ presets: Object.keys(S.presets).map(Number).sort((a, b) => a - b)
                        .map(k => ({ id: k, name: S.presets[k].name, builtIn: !!S.presets[k].builtIn })),
                      current: { presetId: S.presetId, status: S.status, startTime: fmtStart() } });
        case "/preset/content": {
          const id = +(q.get("id") || -1);
          if (!S.presets[id]) return ok({ error: "preset not found" }, 404);
          return ok(JSON.parse(JSON.stringify(S.presets[id])));
        }
        case "/api/sounds": return ok({ sounds: ["zvuk.wav", "stage.wav"] });
        case "/api/time": {
          const n = new Date();
          return ok({ time: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}` });
        }
        case "/api/settings":
          return ok({ ap_ssid: "Premifarm-THS3-1", sta_ssid: "", sta_saved: false, sta_connected: false,
                      home: { mode: "auto", state: "off", ssid: "", hostname: "premifarm-ths3-1",
                              manual: { ip: "", mask: "", gw: "", dns1: "", dns2: "" },
                              apIp: "192.168.4.1", apMoved: false } });
        case "/wifi/status": return ok({ mode: "ap", connected: false });
        case "/wifi/scan":
          return ok({ networks: [{ ssid: "HomeNet", rssi: -55, secure: true },
                                 { ssid: "Office-WiFi", rssi: -71, secure: true }] });
      }
      return ok({ error: "not found" }, 404);
    }

    // POST
    if (path === "/api/ping") return ok({ status: "ok", owner: true });
    if (path === "/api/release") return ok({ status: "released" });
    if (d === null) return ok({ error: "invalid json" }, 400);
    switch (path) {
      case "/api/lang":
        if (!["ru", "en", "et"].includes(d.lang)) return ok({ error: "unknown language" }, 400);
        S.lang = d.lang;
        return ok({ lang: S.lang });
      case "/preset/select": {
        if (!["stopped", "finished"].includes(S.status)) return ok({ error: "stop the running preset first" }, 409);
        const id = d.id || 0;
        if (!S.presets[id]) return ok({ error: "preset not found" }, 404);
        S.presetId = id; S.status = "stopped";
        return ok({ status: "selected", presetId: id });
      }
      case "/preset/start": {
        const id = d.id || 0;
        if (!S.presets[id]) return ok({ error: "preset not found" }, 404);
        Object.assign(S, { presetId: id, status: "running", start: Date.now(), stageIdx: 0, stageStart: Date.now() });
        S.presets[id].stages.forEach((st, i) => { if (st.id === d.stageId) S.stageIdx = i; });
        const r = { status: "running", startTime: fmtStart(), presetId: id };
        sensors(r);
        return ok(r);
      }
      case "/preset/stage": {
        if (!active()) return ok({ error: "no task running" }, 409);
        const ids = curStages().map(st => st.id);
        if (!ids.includes(d.stageId)) return ok({ error: "stage not found" }, 404);
        S.stageIdx = ids.indexOf(d.stageId); S.stageStart = Date.now();
        if (S.status === "frozen") S.status = "running";
        const r = { status: S.status, startTime: fmtStart() };
        sensors(r);
        return ok(r);
      }
      case "/preset/pause":
      case "/task/pause": {
        if (S.status !== "running") return ok({ error: "not running" }, 400);
        S.status = "paused";
        const r = { status: "paused", startTime: fmtStart() };
        sensors(r);
        return ok(r);
      }
      case "/preset/resume": {
        if (!["paused", "frozen"].includes(S.status)) return ok({ error: "not paused" }, 400);
        S.status = "running";
        const r = { status: "running", startTime: fmtStart() };
        sensors(r);
        return ok(r);
      }
      case "/preset/stop":
        S.status = "stopped"; S.start = null;
        return ok({ status: "stopped", startTime: "", message: "preset stopped" });
      case "/preset/save": {
        const pr = d.preset;
        if (!pr || typeof pr !== "object") return ok({ error: "missing preset" }, 400);
        if (!pr.name) return ok({ error: "missing name" }, 400);
        if (pr.name === "Default") return ok({ error: "name reserved for the template" }, 400);
        let id = pr.id || 0;
        if (id === 0) id = Math.max(...Object.keys(S.presets).map(Number)) + 1;
        pr.id = id; pr.builtIn = false; S.presets[id] = pr;
        return ok({ status: "saved", id: id, name: pr.name });
      }
      case "/preset/delete": {
        const id = d.id || 0;
        if (id === 0) return ok({ error: "the template cannot be deleted" }, 400);
        if (!S.presets[id]) return ok({ error: "preset not found" }, 404);
        delete S.presets[id];
        if (S.presetId === id) { S.presetId = 0; S.status = "stopped"; S.start = null; }
        return ok({ status: "deleted", id: id });
      }
      case "/api/notice/ok": S.notice = null; return ok({ status: "ok" });
      case "/playground/control":
      case "/playground/params":
        if (!(d.id >= 0 && d.id < OUT.length)) return ok({ error: "Invalid ID" }, 400);
        return ok({ status: "ok" });
      case "/playground/sound": return ok({ status: "playing" });
      case "/api/settings": return ok({ status: "saved" });       // no restart in the demo
      case "/api/time": return ok({ status: "ok" });
      case "/wifi/connect": return ok({ status: "connecting" }, 202);
      case "/wifi/disconnect": return ok({ status: "disconnected" });
    }
    return ok({ error: "not found" }, 404);
  }

  /* ---------- request plumbing ---------- */
  const API = /^\/(api|preset|playground|wifi|task)\//;

  function parseBody(data) {
    if (data === undefined || data === null || data === "") return {};
    if (typeof data === "object" && !(data instanceof FormData)) return data;
    const s = String(data);
    try { return JSON.parse(s); } catch (e) { /* not JSON */ }
    if (s.indexOf("=") > 0) {
      const o = {};
      new URLSearchParams(s).forEach((v, k) => { o[k] = isNaN(v) || v === "" ? v : Number(v); });
      return o;
    }
    return null;
  }

  function answer(method, url, data) {
    const u = new URL(url, location.href);
    const res = handle(String(method || "GET").toUpperCase(), u.pathname, u.searchParams,
                       String(method || "GET").toUpperCase() === "POST" ? parseBody(data) : {});
    return { code: res.code, text: JSON.stringify(res.body) };
  }

  const isApi = url => {
    try { return API.test(new URL(url, location.href).pathname); } catch (e) { return false; }
  };
  const LATENCY = 40;                         // a little delay, like a real network

  // jQuery ($.ajax, $.getJSON, $.post)
  if (window.jQuery) {
    jQuery.ajaxTransport("+*", function (options) {
      if (!isApi(options.url)) return undefined;
      let timer = null;
      return {
        send: function (headers, complete) {
          timer = setTimeout(() => {
            const r = answer(options.type, options.url, options.data);
            complete(r.code, r.code < 400 ? "OK" : "Error", { text: r.text }, "Content-Type: application/json\r\n");
          }, LATENCY);
        },
        abort: function () { clearTimeout(timer); }
      };
    });
  }

  // fetch()
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    if (!isApi(url)) return realFetch(input, init);
    const method = (init && init.method) || (typeof input === "object" && input.method) || "GET";
    const r = answer(method, url, init && init.body);
    return new Promise(resolve => setTimeout(() => resolve(new Response(r.text, {
      status: r.code, headers: { "Content-Type": "application/json" }
    })), LATENCY));
  };

  // navigator.sendBeacon (session release on leaving)
  if (navigator.sendBeacon) {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (!isApi(url)) return realBeacon(url, data);
      answer("POST", url, data);
      return true;
    };
  }

  /* ---------- "Demo" mark in the top bar ---------- */
  function showBadge() {
    const st = document.createElement("style");
    st.textContent = ".demo-badge{font-size:.75rem;font-weight:600;padding:.3em .6em;margin-left:auto;" +
                     "cursor:help;white-space:nowrap}" +
                     ".demo-badge+#datetime{margin-left:.5rem!important}";
    document.head.appendChild(st);
    const b = document.createElement("span");
    b.className = "badge badge-warning demo-badge";
    b.setAttribute("data-i18n", "demo.badge");
    b.setAttribute("data-i18n-title", "demo.tip");
    b.textContent = "Demo";
    b.title = "Demo mode: no controller, changes are not saved";
    const dt = document.getElementById("datetime");
    if (dt && dt.parentNode) dt.parentNode.insertBefore(b, dt);
    if (typeof applyI18n === "function") applyI18n();
  }

  showBadge();
  console.info("Demo mode: no controller found, sample data is used");
  window.DEMO_READY = true;
})();
