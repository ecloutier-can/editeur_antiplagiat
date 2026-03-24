/*
  SCORM 1.2 API Wrapper — Éditeur Anti-Plagiat v2.0.0
  Support Multi-Environnement : Moodle (SCORM) & Standalone (GitHub Pages)
*/

var SCORM = (function () {
  'use strict';
  var _api  = null;
  var _init = false;
  var _config = null;
  var _isStandalone = false;

  function findAPI(w) {
    var d = 0;
    while (!w.API && w.parent && w.parent !== w && d < 7) { d++; w = w.parent; }
    return w.API || null;
  }

  function getAPI() {
    if (!_api) {
      _api = findAPI(window);
      if (!_api && window.opener) _api = findAPI(window.opener);
    }
    return _api;
  }

  function call(fn, args) {
    var a = getAPI();
    if (!a) return null;
    try { return a[fn].apply(a, args || []); } catch (e) { return null; }
  }

  /* ── Configuration ────────────────────────── */
  async function loadConfig() {
    try {
      const response = await fetch('config.json');
      _config = await response.json();
      console.log("Config loaded:", _config);
    } catch (e) {
      console.error("Failed to load config.json, using defaults.", e);
      _config = { security: {}, pedagogy: {}, ui: {}, messages: {} };
    }
    // Dispatch event to notify that config is ready
    window.dispatchEvent(new CustomEvent('scorm_config_ready', { detail: _config }));
  }

  /* ── localStorage helpers ─────────────────── */
  function lsKey(studentId) {
    return 'scorm_editor_' + (studentId || 'anon');
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); return true; } catch(e) { return false; }
  }
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch(e) { return null; }
  }

  return {
    init: function () {
      var r = call('LMSInitialize', ['']);
      _init = (r === 'true' || r === true);
      _isStandalone = !_init;
      
      // Load configuration asynchronously
      loadConfig();
      
      return _init;
    },

    isStandalone: function() { return _isStandalone; },
    getConfig: function() { return _config; },

    get: function (k) {
      if (!_init) return '';
      var r = call('LMSGetValue', [k]);
      return r !== null ? String(r) : '';
    },
    set: function (k, v) {
      if (!_init) return false;
      var r = call('LMSSetValue', [k, String(v)]);
      return r === 'true' || r === true;
    },
    commit: function () { if (_init) call('LMSCommit', ['']); },
    finish: function () {
      if (!_init) return;
      call('LMSCommit', ['']);
      call('LMSFinish', ['']);
      _init = false;
    },

    getStudentName: function () { 
      if (_isStandalone) return 'Étudiant (Démo)';
      return this.get('cmi.core.student_name') || 'Étudiant'; 
    },
    getStudentId:   function () { 
      if (_isStandalone) return 'github_demo_id';
      return this.get('get_student_id') || this.get('cmi.core.student_id') || ''; 
    },

    save: function (obj) {
      var studentId = this.getStudentId();

      /* 1. TEXTE COMPLET → localStorage */
      var lsData = {
        v:       obj.v || 2,
        text:    obj.text || '',
        ts:      Date.now(),
        wc:      obj.wc || 0,
        submitted:  obj.submitted  || false,
        submitTime: obj.submitTime || null
      };
      lsSet(lsKey(studentId), JSON.stringify(lsData));

      /* 2. MÉTADONNÉES → SCORM */
      if (_init) {
        var meta = {
          v:          obj.v || 2,
          log:        (obj.log || []).slice(-10),
          paste:      obj.paste      || 0,
          copy:       obj.copy       || 0,
          tabs:       obj.tabs       || 0,
          focus:      obj.focus      || 0,
          screenshots:obj.screenshots|| 0,
          absentMs:   obj.absentMs   || 0,
          lastIssues: (obj.lastIssues|| []).slice(0,5),
          submitted:  obj.submitted  || false,
          submitTime: obj.submitTime || null,
          wc:         obj.wc         || 0,
          lsKey:      lsKey(studentId)
        };
        var json = JSON.stringify(meta);
        if (json.length > 3900) {
          meta.log = meta.log.slice(-5);
          meta.lastIssues = [];
          json = JSON.stringify(meta);
        }
        this.set('cmi.suspend_data', json);

        var plain = (obj.text || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
        this.set('cmi.comments', plain.substring(0, 2000));
        this.commit();
      }
    },

    load: function () {
      var studentId = this.getStudentId();
      var lsRaw  = lsGet(lsKey(studentId));
      var lsData = null;
      if (lsRaw) {
        try { lsData = JSON.parse(lsRaw); } catch(e) {}
      }

      var meta = null;
      if (_init) {
        var raw = this.get('cmi.suspend_data');
        if (raw && raw.length > 2) {
          try { meta = JSON.parse(raw); } catch(e) {}
        }
      }

      if (!lsData && !meta) return null;

      var result = {};
      if (meta)   Object.assign(result, meta);
      if (lsData) {
        result.text = lsData.text;
        result.submitted = lsData.submitted || result.submitted;
        result.submitTime = lsData.submitTime || result.submitTime;
        result.wc = lsData.wc || result.wc;
        if (lsData.submitted) {
          result.submitted = true;
          result.submitTime = lsData.submitTime;
        }
      }
      return result;
    },

    submit: function (score) {
      if (_isStandalone) {
        console.log("Standalone: Submission simulation score:", score);
        return true;
      }
      this.set('cmi.core.score.raw', score || 100);
      this.set('cmi.core.score.min', 0);
      this.set('cmi.core.score.max', 100);
      this.set('cmi.core.lesson_status', 'passed');
      this.set('cmi.core.exit', '');
      this.commit();
    }
  };
})();
