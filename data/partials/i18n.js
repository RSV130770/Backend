/* ============================================================
   I18N  (first partial in app.js)
   - Texts live in /local.json: key -> {en, ru, et}.
   - t(key, params): the text in the current language. A missing
     translation falls back to English, a missing key to the key itself;
     both are reported once in the console. {name} placeholders are
     filled from params.
   - HTML: data-i18n (text), data-i18n-ph (placeholder), data-i18n-title
     (tooltip), data-i18n-aria (aria-label). Put data-i18n only on
     elements without child elements: it replaces the whole text. An
     element keeps its built-in English text if the file is missing.
   - The choice is kept per farm, in the controller's RTC memory
     (GET/POST /api/lang). Never chosen yet: the phone's language if
     there is a translation, else English. The phone keeps a copy
     (localStorage) for when the controller cannot be reached.
   - onLanguageChange(fn): screens that build text in JS redraw it there.
   - #lang-flags (Settings) gets one flag button per language.
   ============================================================ */

const I18N_STORE = "premifarm.lang";
const I18N = { lang: "en", def: "en", langs: [], text: {}, loaded: false, farm: "" };
const i18nWarned = new Set();
const i18nHooks = [];

function i18nWarn(msg) {
  if (i18nWarned.has(msg)) return;
  i18nWarned.add(msg);
  console.warn("i18n: " + msg);
}

function t(key, params) {
  const e = I18N.text[key];
  let s;
  if (!e) {
    if (I18N.loaded) i18nWarn("missing key " + key);
    s = key;
  } else {
    s = e[I18N.lang];
    if (!s) {
      i18nWarn("no " + I18N.lang + " text for " + key);
      s = e[I18N.def] || e.en || key;
    }
  }
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

function hasText(key) { return !!I18N.text[key]; }

// Names written by the controller in English (the built-in Default task:
// its name, stages, groups, messages) are shown in the chosen language.
// Any other name (typed by the user) is shown as it is.
let i18nNames = null;               // English text -> key, for tpl.* keys
function tName(s) {
  if (!s) return s || "";
  if (!i18nNames) {
    i18nNames = {};
    Object.keys(I18N.text).forEach(k => {
      if (k.startsWith("tpl.") && I18N.text[k].en) i18nNames[I18N.text[k].en] = k;
    });
  }
  const key = i18nNames[s];
  return key ? t(key) : s;
}

// Output name: translated while it is the controller's standard English
// name for that channel (out.<id>); a renamed output keeps its own name
function outLabel(cfg) {
  if (!cfg) return "";
  const e = I18N.text["out." + cfg.id];
  return e && e.en === cfg.label ? t("out." + cfg.id) : (cfg.label || "Ch" + cfg.id);
}

// Fill the data-i18n* attributes inside root (default: the whole page)
function applyI18n(root) {
  const scope = root || document;
  const fill = (attr, put) => scope.querySelectorAll("[" + attr + "]").forEach(el => {
    const key = el.getAttribute(attr);
    if (hasText(key)) put(el, t(key));
  });
  fill("data-i18n", (el, s) => { el.textContent = s; });
  fill("data-i18n-ph", (el, s) => { el.placeholder = s; });
  fill("data-i18n-title", (el, s) => { el.title = s; });
  fill("data-i18n-aria", (el, s) => { el.setAttribute("aria-label", s); });
}

function onLanguageChange(fn) { i18nHooks.push(fn); }

function setLanguage(code) {
  if (!I18N.langs.some(l => l.code === code)) return;
  I18N.lang = code;
  try { localStorage.setItem(I18N_STORE, code); } catch (e) { /* private mode */ }
  saveFarmLanguage(code);
  document.documentElement.lang = code;
  applyI18n();
  renderLangButtons();
  i18nHooks.forEach(fn => { try { fn(code); } catch (e) { console.error(e); } });
}

// The farm keeps the choice (RTC memory); only the session owner can
// change it. Not reachable (demo mode): the phone's copy is enough.
function saveFarmLanguage(code) {
  if (typeof OFFLINE_MODE !== "undefined" && OFFLINE_MODE) return;
  if (code === I18N.farm) return;
  fetch("/api/lang", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang: code })
  })
    .then(r => { if (r.ok) I18N.farm = code; else console.warn("i18n: language not saved on the farm (HTTP " + r.status + ")"); })
    .catch(() => console.warn("i18n: language not saved on the farm"));
}

function i18nPick() {
  const codes = I18N.langs.map(l => l.code);
  if (I18N.farm && codes.includes(I18N.farm)) return I18N.farm;   // the farm's choice
  let saved = null;
  try { saved = localStorage.getItem(I18N_STORE); } catch (e) { /* private mode */ }
  if (saved && codes.includes(saved)) return saved;
  const wanted = navigator.languages || [navigator.language || ""];
  for (const l of wanted) {
    const c = String(l).slice(0, 2).toLowerCase();
    if (codes.includes(c)) return c;
  }
  return I18N.def;
}

/* ---------- flag buttons ---------- */
// Drawn here, not emoji: Windows shows emoji flags as two letters
const I18N_FLAGS = {
  en: '<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      '<clipPath id="ukT"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath>' +
      '<path d="M0,0v30h60v-30z" fill="#012169"/>' +
      '<path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6"/>' +
      '<path d="M0,0L60,30M60,0L0,30" clip-path="url(#ukT)" stroke="#C8102E" stroke-width="4"/>' +
      '<path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/>' +
      '<path d="M30,0v30M0,15h60" stroke="#C8102E" stroke-width="6"/></svg>',
  ru: '<svg viewBox="0 0 9 6" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect width="9" height="2" fill="#fff"/><rect y="2" width="9" height="2" fill="#0039A6"/>' +
      '<rect y="4" width="9" height="2" fill="#D52B1E"/></svg>',
  et: '<svg viewBox="0 0 33 21" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect width="33" height="7" fill="#0072CE"/><rect y="7" width="33" height="7" fill="#000"/>' +
      '<rect y="14" width="33" height="7" fill="#fff"/></svg>'
};

function renderLangButtons() {
  const box = document.getElementById("lang-flags");
  if (!box || !I18N.langs.length) return;
  box.innerHTML = "";
  I18N.langs.forEach(l => {
    const b = document.createElement("button");
    b.type = "button";
    // Same look as the other buttons: btn + btn-small (raised, pressed when active)
    b.className = "btn btn-light btn-small lang-btn" + (l.code === I18N.lang ? " active" : "");
    b.setAttribute("aria-pressed", l.code === I18N.lang ? "true" : "false");
    b.dataset.lang = l.code;
    b.innerHTML = (I18N_FLAGS[l.code] || "") + "<span></span>";
    b.querySelector("span").textContent = l.name;       // the language's own name
    b.addEventListener("click", () => setLanguage(l.code));
    box.appendChild(b);
  });
  const card = box.closest(".card");
  if (card) card.style.display = "";                    // hidden until there are languages
}

/* ---------- loading ---------- */
// The app starts after this (system.js waits for I18N_READY); a missing or
// broken file leaves the built-in English texts in place.
const I18N_READY = new Promise(resolve => {
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    I18N.lang = i18nPick();
    document.documentElement.lang = I18N.lang;
    const go = () => { applyI18n(); renderLangButtons(); resolve(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
    else go();
  };
  const timer = setTimeout(() => { console.warn("i18n: /local.json timed out"); done(); }, 8000);
  // The farm's language ("" = never chosen); an old firmware without
  // /api/lang, or no controller at all, just leaves it empty
  const farmLang = fetch("/api/lang", { cache: "no-store" })
    .then(r => (r.ok ? r.json() : {}))
    .then(d => { I18N.farm = (d && d.lang) || ""; })
    .catch(() => {});
  const texts = fetch("/local.json", { cache: "no-cache" })
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(d => {
      I18N.text = d.text || {};
      I18N.langs = d.languages || [];
      I18N.def = d.default || "en";
      I18N.loaded = true;
    })
    .catch(e => console.warn("i18n: /local.json not loaded (" + e.message + "), English only"));
  Promise.all([texts, farmLang]).then(() => { clearTimeout(timer); done(); });
});
