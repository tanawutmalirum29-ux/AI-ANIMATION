/* Story Studio — automatic update to the latest deployment.
   amplify.yml stamps every build with an id in <meta name="studio-build"> and in /version.json.
   This script compares the two; when a newer build is live it reloads the page by itself,
   but only at a safe moment (not playing, not exporting, not recording, not typing, a few seconds
   after the last touch) so work and long jobs are never interrupted. Projects are autosaved on every
   change, so the reload resumes where you left off. Without a stamped build (local files) it stays off. */
(function () {
  'use strict';
  if (window.StudioUpdater) return;

  var meta = document.querySelector('meta[name="studio-build"]');
  var MINE = ((meta && meta.content) || '').trim();
  var STAMPED = !!MINE && !/^__.*__$/.test(MINE);

  var POLL_MS = 45000;        // check while the page is visible
  var IDLE_MS = 2500;         // wait after the last touch/key so the autosave has finished
  var BUSY_RETRY_MS = 3000;   // re-test "is it safe now?" while something is running
  var COOLDOWN_MS = 120000;   // never chase the same build again within 2 min (CDN not ready yet)
  var KEY = 'storyStudio.updater.v1';

  var lastInput = Date.now();
  var pendingBuild = '';
  var busyTimer = 0;
  var checking = false;
  var reloading = false;
  var pill = null;

  ['pointerdown', 'touchstart', 'keydown', 'wheel'].forEach(function (name) {
    addEventListener(name, function () { lastInput = Date.now(); }, { capture: true, passive: true });
  });

  function readMark() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function writeMark(value) {
    try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  function say(text) {
    if (!document.body) return;
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'studioUpdatePill';
      pill.setAttribute('role', 'status');
      pill.style.cssText = 'position:fixed;left:50%;bottom:calc(10px + env(safe-area-inset-bottom,0px));' +
        'transform:translateX(-50%);z-index:99998;background:#1f2a1fee;color:#d8f3d0;border:1px solid #6fae6a;' +
        'border-radius:999px;padding:4px 12px;font-size:11px;line-height:1.4;pointer-events:none;max-width:92vw;' +
        'text-align:center;box-shadow:0 3px 12px #0008';
      document.body.appendChild(pill);
    }
    pill.textContent = text;
    pill.style.display = text ? 'block' : 'none';
  }

  /* Why NOT to reload right now ('' = safe). Bare names are globals of the editor's classic scripts. */
  function busyReason() {
    try { if (typeof playing !== 'undefined' && playing) return 'playing'; } catch (e) {}
    try { if (typeof EXPORT_BATCH_RUNNING !== 'undefined' && EXPORT_BATCH_RUNNING) return 'export'; } catch (e) {}
    try { if (typeof ACTIVE_EXPORT !== 'undefined' && ACTIVE_EXPORT) return 'export'; } catch (e) {}
    try {
      if (typeof VOICE_RECORDER !== 'undefined' && VOICE_RECORDER &&
          VOICE_RECORDER.state && VOICE_RECORDER.state !== 'inactive') return 'recording';
    } catch (e) {}
    var a = document.activeElement;
    if (a && a !== document.body) {
      var tag = a.tagName;
      var type = String(a.type || '').toLowerCase();
      var texty = tag === 'TEXTAREA' ||
        (tag === 'INPUT' && /^(|text|search|url|email|number|password|tel)$/.test(type)) ||
        a.isContentEditable;
      if (texty && (a.isContentEditable || String(a.value || '').length)) return 'typing';
    }
    if (Date.now() - lastInput < IDLE_MS) return 'recent-touch';
    return '';
  }

  function reloadNow(build) {
    if (reloading) return;
    reloading = true;
    writeMark({ target: build, at: Date.now() });
    say('กำลังอัปเดตเป็นเวอร์ชันล่าสุด…');
    // refresh the cached copy of the page itself first, then reload so the new index.html is used
    var done = function () { location.reload(); };
    try {
      fetch(location.href, { cache: 'reload', credentials: 'same-origin' }).then(done, done);
    } catch (e) { done(); }
    setTimeout(done, 4000); // never hang on a slow network
  }

  function waitUntilSafe() {
    clearTimeout(busyTimer);
    if (!pendingBuild || reloading) return;
    var why = busyReason();
    if (!why) { reloadNow(pendingBuild); return; }
    say('มีเวอร์ชันใหม่ · จะอัปเดตอัตโนมัติเมื่อหยุดใช้งาน');
    busyTimer = setTimeout(waitUntilSafe, BUSY_RETRY_MS);
  }

  function fetchRemoteBuild() {
    return fetch('version.json?_=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.build ? String(j.build) : ''; })
      .catch(function () { return ''; });
  }

  function check() {
    if (!STAMPED || checking || reloading) return Promise.resolve(false);
    checking = true;
    return fetchRemoteBuild().then(function (remote) {
      checking = false;
      if (!remote) return false;
      var mark = readMark();
      if (remote === MINE) { if (mark) writeMark(null); pendingBuild = ''; say(''); return false; }
      // We reloaded for this build moments ago and still got the old page: the CDN is catching up. Retry later.
      if (mark && mark.target === remote && Date.now() - mark.at < COOLDOWN_MS) return false;
      pendingBuild = remote;
      waitUntilSafe();
      return true;
    }, function () { checking = false; return false; });
  }

  function visibleCheck() { if (!document.hidden) check(); }

  if (STAMPED) {
    setInterval(visibleCheck, POLL_MS);
    document.addEventListener('visibilitychange', visibleCheck);   // coming back to the tab / app
    addEventListener('focus', visibleCheck);
    addEventListener('online', visibleCheck);
    addEventListener('pageshow', visibleCheck);                    // restored from back-forward cache
    setTimeout(visibleCheck, 1500);                                // right after opening
  }

  window.StudioUpdater = {
    build: MINE,
    enabled: STAMPED,
    check: check,
    pending: function () { return pendingBuild; },
    busy: busyReason
  };
})();
