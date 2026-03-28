/**
 * AI Monitor Module for AntiPlagiat Editor
 * Implements local face recognition with a 5-second safety countdown.
 * Uses TensorFlow.js and BlazeFace.
 * Modular and non-intrusive.
 */

(function() {
  'use strict';

  let _model = null;
  let _video = null;
  let _canvas = null;
  let _ctx = null;
  let _intervalId = null;
  let _config = null;
  
  // Timer state
  let _isWarningActive = false;
  let _countdownValue = 5;
  let _countdownTimer = null;

  // DOM Elements
  const _overlay = document.getElementById('ai-warning');
  const _timerEl = document.getElementById('ai-timer');

  /**
   * Initialize Audio and Video for tracking
   */
  function setup() {
    _video = document.createElement('video');
    _video.width = 160;
    _video.height = 120;
    _video.autoplay = true;
    _video.muted = true;
    _video.style.display = 'none';
    document.body.appendChild(_video);

    _canvas = document.createElement('canvas');
    _canvas.width = 160;
    _canvas.height = 120;
    _ctx = _canvas.getContext('2d');
  }

  /**
   * Load the BlazeFace model
   */
  async function initModel() {
    try {
      console.log("🤖 IA: Chargement du modèle BlazeFace...");
      _model = await blazeface.load();
      console.log("✅ IA: Modèle chargé.");
      startMonitoring();
    } catch (e) {
      console.error("❌ IA: Échec du chargement du modèle.", e);
    }
  }

  /**
   * Periodic check loop
   */
  function startMonitoring() {
    const interval = (_config && _config.security && _config.security.aiScanInterval) || 4000;
    
    _intervalId = setInterval(async () => {
      // Check if monitoring is allowed by the main app (not paused, exam started)
      if (typeof window.isAIAllowed === 'function' && !window.isAIAllowed()) {
        resetWarning();
        return;
      }

      const stream = typeof window.getCameraStream === 'function' ? window.getCameraStream() : null;
      if (!stream) return;

      if (_video.srcObject !== stream) {
        _video.srcObject = stream;
      }

      try {
        const predictions = await _model.estimateFaces(_video, false);
        
        if (predictions.length === 0) {
          // No face detected
          triggerWarning();
        } else if (predictions.length > 1) {
          // Multi-person detected - logger immédiat
          infractionDetected("Multi-personnes détectées par l'IA.");
          resetWarning();
        } else {
          // Exactly one face - All good
          resetWarning();
        }
      } catch (e) {
        // Ignored error (often due to video not ready yet)
      }
    }, interval);
  }

  /**
   * Handle the 5-second countdown
   */
  function triggerWarning() {
    if (_isWarningActive) return;

    _isWarningActive = true;
    _countdownValue = 5;
    _overlay.style.display = 'flex';
    updateTimerUI();

    _countdownTimer = setInterval(() => {
      _countdownValue--;
      updateTimerUI();

      // Play beep sound
      if (typeof window.playBip === 'function') {
        window.playBip(880, 0, 0.1, 0.2, 'sine');
      }

      if (_countdownValue <= 0) {
        infractionDetected("Absence prolongée (+5s) détectée par l'IA.");
        resetWarning();
      }
    }, 1000);
  }

  /**
   * Reset warning state if student returns
   */
  function resetWarning() {
    if (!_isWarningActive) return;

    _isWarningActive = false;
    clearInterval(_countdownTimer);
    _overlay.style.display = 'none';
  }

  function updateTimerUI() {
    if (_timerEl) _timerEl.textContent = _countdownValue;
  }

  /**
   * Final infraction logging and capture
   */
  function infractionDetected(reason) {
    console.warn("🚨 IA: Infraction détectée:", reason);
    
    if (typeof window.log === 'function') {
      window.log('SÉCURITÉ', reason, 'd');
    }
    
    if (typeof window.capturePhoto === 'function') {
      window.capturePhoto('ALERTE IA: ' + reason);
    }
  }

  // Initialization: Wait for config
  window.addEventListener('scorm_config_ready', (e) => {
    _config = e.detail;
    if (_config && _config.security && _config.security.enableAI) {
      setup();
      initModel();
    } else {
      console.log("ℹ️ IA: Désactivée par la configuration.");
    }
  });

})();
