/**
 * AI Monitor Module for AntiPlagiat Editor (v2.0)
 * Implements reliable face tracking with visual student feedback.
 */

(function() {
  'use strict';

  let _model = null;
  let _aiVideo = null;
  let _intervalId = null;
  let _config = null;
  let _startTime = null;
  
  // Timer state
  let _isWarningActive = false;
  let _countdownValue = 5;
  let _countdownTimer = null;

  // DOM Elements
  const _overlay = document.getElementById('ai-warning');
  const _timerEl = document.getElementById('ai-timer');
  const _statusEl = document.getElementById('ai-status');

  /**
   * Update the UI indicator in the header
   * States: 'initial', 'searching', 'success', 'warn'
   */
  function updateStatusUI(state) {
    if (!_statusEl) return;
    
    // Clear previous AI classes
    _statusEl.classList.remove('off', 'ai-searching', 'ai-success', 'ai-warn');
    
    const dot = _statusEl.querySelector('.hst-dot');
    const label = _statusEl.lastChild;
    
    switch(state) {
      case 'searching':
        _statusEl.classList.add('ai-searching');
        label.textContent = " IA : Analyse...";
        break;
      case 'success':
        _statusEl.classList.add('ai-success');
        label.textContent = " IA : Visage OK";
        break;
      case 'warn':
        _statusEl.classList.add('ai-warn');
        label.textContent = " IA : Absence !";
        break;
      default:
        _statusEl.classList.add('off');
        label.textContent = " IA : Désactivée";
    }
  }

  /**
   * Load the BlazeFace model
   */
  async function init() {
    try {
      _aiVideo = document.getElementById('ai-video');
      console.log("🤖 IA: Chargement du modèle BlazeFace...");
      _model = await blazeface.load();
      console.log("✅ IA: Modèle chargé.");
      updateStatusUI('searching');
      _startTime = Date.now();
      startMonitoring();
    } catch (e) {
      console.error("❌ IA: Erreur critique.", e);
    }
  }

  /**
   * Periodic check loop
   */
  function startMonitoring() {
    // On utilise l'intervalle configuré ou 4s par défaut
    const interval = (_config && _config.security && _config.security.aiScanInterval) || 4000;
    
    _intervalId = setInterval(async () => {
      // 1. Logic Check: est-on en train de passer l'examen?
      if (typeof window.isAIAllowed === 'function' && !window.isAIAllowed()) {
        resetWarning();
        updateStatusUI('initial');
        return;
      }

      // 2. Video Context Check
      // On récupère le flux global via l'API exposée par index.html/scorm_api.js
      const stream = typeof window.getCameraStream === 'function' ? window.getCameraStream() : null;
      if (!stream || !_aiVideo) return;

      // Attacher le flux si nécessaire
      if (_aiVideo.srcObject !== stream) {
        _aiVideo.srcObject = stream;
        _aiVideo.play().catch(() => {});
      }

      // Vérifier que la vidéo est prête et "chaude"
      if (_aiVideo.paused || _aiVideo.readyState < 2 || _aiVideo.videoWidth === 0) {
        _aiVideo.play().catch(() => {});
        return;
      }

      // 3. Délai de grâce initial (ex: 3s après le démarrage du moniteur)
      if (Date.now() - _startTime < 3000) return;

      try {
        // 4. Estimation BlazeFace
        // Note: BlazeFace est optimisé pour les portraits proches (caméra frontale)
        const predictions = await _model.estimateFaces(_aiVideo, false);
        
        // Filtre de confiance à 0.5
        const validFaces = predictions.filter(p => {
            // Le score peut être dans p.probability ou p.probability[0] selon la version
            const score = Array.isArray(p.probability) ? p.probability[0] : p.probability;
            return score > 0.5;
        });

        if (validFaces.length === 0) {
          // Aucun visage détecté
          updateStatusUI('warn');
          triggerWarning();
        } else if (validFaces.length > 1) {
          // Plusieurs personnes - Infraction immédiate
          infractionDetected("Multi-personnes détectées par l'IA (" + validFaces.length + ")");
          updateStatusUI('warn');
          resetWarning();
        } else {
          // Un seul visage - Tout est OK
          updateStatusUI('success');
          resetWarning();
        }
      } catch (e) {
        console.error("🤖 IA Analysis Error:", e);
      }
    }, interval);
  }

  /**
   * Gestion du compte à rebours de 5 secondes
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

      // Alerte sonore si disponible
      if (typeof window.playBip === 'function') {
        window.playBip(880, 0, 0.1, 0.2, 'sine');
      }

      if (_countdownValue <= 0) {
        infractionDetected("Absence prolongée (+5s) détectée par l'IA.");
        resetWarning();
      }
    }, 1000);
  }

  function resetWarning() {
    if (!_isWarningActive) return;
    _isWarningActive = false;
    clearInterval(_countdownTimer);
    _overlay.style.display = 'none';
  }

  function updateTimerUI() {
    if (_timerEl) _timerEl.textContent = _countdownValue;
  }

  function infractionDetected(reason) {
    console.warn("🚨 IA: Infraction détectée:", reason);
    if (typeof window.log === 'function') window.log('SÉCURITÉ', reason, 'd');
    if (typeof window.capturePhoto === 'function') {
      window.capturePhoto('ALERTE IA: ' + reason);
    }
  }

  // Écouter l'événement Global de chargement de conf
  window.addEventListener('scorm_config_ready', (e) => {
    _config = e.detail;
    if (_config && _config.security && _config.security.enableAI) {
      init();
    } else {
      updateStatusUI('initial');
    }
  });

})();
