/**
 * AI Monitor Module for AntiPlagiat Editor (v2.0)
 * Implements reliable face tracking with visual student feedback.
 */

(function () {
  'use strict';

  let _model = null;
  let _aiVideo = null;
  let _intervalId = null;
  let _config = null;
  let _startTime = null;
  let _multiPersonCount = 0;
  let _absenceCount = 0;    // Compteur pour l'absence contextuelle
  let _lastTypingTime = 0;  // Horodatage de la dernière frappe
  let _isEditorFocused = false; // Suivi du focus sur l'éditeur principal

  // Timer state
  let _isWarningActive = false;
  let _countdownValue = 5;
  let _countdownTimer = null;

  // DOM Elements
  const _overlay = document.getElementById('ai-warning');
  const _timerEl = document.getElementById('ai-timer');
  const _statusEl = document.getElementById('ai-status');
  const _editor = document.getElementById('ed');

  /**
   * Update the UI indicator in the header
   * States: 'initial', 'searching', 'success', 'warn'
   */
  function updateStatusUI(state) {
    if (!_statusEl) return;

    // Nettoyer les classes IA
    _statusEl.classList.remove('off', 'ai-searching', 'ai-success', 'ai-warn', 'ai-uncertain');

    let labelText = "";
    switch (state) {
      case 'searching':
        _statusEl.classList.add('ai-searching');
        labelText = " IA : Analyse en cours…";
        break;
      case 'success':
        _statusEl.classList.add('ai-success');
        labelText = " IA : Visage détecté";
        break;
      case 'uncertain':
        _statusEl.classList.add('ai-uncertain');
        labelText = " IA : Présent ?";
        break;
      case 'warn':
        _statusEl.classList.add('ai-warn');
        labelText = " IA : Absence détectée";
        break;
      default:
        _statusEl.classList.add('off');
        labelText = " IA : Désactivée";
    }

    // Mise à jour robuste de l'affichage
    _statusEl.innerHTML = '<span class="hst-dot"></span>' + labelText;
  }

  /**
   * Calcule l'Intersection over Union (IOU) entre deux boîtes englobantes
   * Utilisé pour fusionner les doublons techniques d'un même visage.
   */
  function calculateIOU(boxA, boxB) {
    const xA = Math.max(boxA.topLeft[0], boxB.topLeft[0]);
    const yA = Math.max(boxA.topLeft[1], boxB.topLeft[1]);
    const xB = Math.min(boxA.bottomRight[0], boxB.bottomRight[0]);
    const yB = Math.min(boxA.bottomRight[1], boxB.bottomRight[1]);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    if (interArea === 0) return 0;

    const areaA = (boxA.bottomRight[0] - boxA.topLeft[0]) * (boxA.bottomRight[1] - boxA.topLeft[1]);
    const areaB = (boxB.bottomRight[0] - boxB.topLeft[0]) * (boxB.bottomRight[1] - boxB.topLeft[1]);

    return interArea / (areaA + areaB - interArea);
  }

  /**
   * Filtre les doublons de détection basés sur le chevauchement (IOU)
   */
  function filterDuplicates(predictions) {
    if (predictions.length <= 1) return predictions;

    let filtered = [];
    for (let i = 0; i < predictions.length; i++) {
      let isDuplicate = false;
      for (let j = 0; j < filtered.length; j++) {
        if (calculateIOU(predictions[i], filtered[j]) > 0.25) { // Seuil IOU à 25% (plus agressif pour fusionner)
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) filtered.push(predictions[i]);
    }
    return filtered;
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

      // Setup editor listeners if available
      if (_editor) {
        _isEditorFocused = (document.activeElement === _editor);
        _editor.addEventListener('focus', () => { _isEditorFocused = true; });
        _editor.addEventListener('blur', () => { _isEditorFocused = false; });
      }

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
      const stream = typeof window.getCameraStream === 'function' ? window.getCameraStream() : null;
      if (!stream || !_aiVideo) return;

      if (_aiVideo.srcObject !== stream) {
        _aiVideo.srcObject = stream;
        _aiVideo.play().catch(() => { });
      }

      if (_aiVideo.paused || _aiVideo.readyState < 2 || _aiVideo.videoWidth === 0) {
        _aiVideo.play().catch(() => { });
        return;
      }

      // 3. Délai de grâce initial
      if (Date.now() - _startTime < 3000) return;

      // 4. Contexte de frappe et focus (Seuils persistants v2.5)
      const isTyping = (Date.now() - _lastTypingTime < 10000); // 10s pour couvrir les pauses de réflexion

      try {
        // 5. Estimation BlazeFace
        const predictions = await _model.estimateFaces(_aiVideo, false);

        let validFaces = predictions.filter(p => {
          const score = Array.isArray(p.probability) ? p.probability[0] : p.probability;
          return score > 0.85; // Seuil de confiance strict pour éviter les faux positifs (ghosts)
        });

        validFaces = filterDuplicates(validFaces);

        // --- NOUVELLE LOGIQUE CONTEXTUELLE (Seuils adaptatifs) ---
        if (validFaces.length === 0) {
          _absenceCount++;
          
          let threshold = 2; // Par défaut (8s)
          if (isTyping) {
            threshold = 8; // Saisie active (32s)
          } else if (_isEditorFocused) {
            threshold = 4; // Focus sans frappe (16s)
          }

          if (_absenceCount >= threshold) {
            updateStatusUI('warn');
            triggerWarning(isTyping);
          } else {
            updateStatusUI('uncertain'); 
            console.log("🤖 IA: Présence incertaine (" + _absenceCount + "/" + threshold + ") Focus:" + _isEditorFocused + " Typing:" + isTyping);
          }
        } else if (validFaces.length > 1) {
          _multiPersonCount++;
          _absenceCount = 0;
          if (_multiPersonCount >= 3) { // Exiger 3 confirmations
            infractionDetected("Multi-personnes confirmées par l'IA (" + validFaces.length + ")");
            updateStatusUI('warn');
            resetWarning();
          } else {
            updateStatusUI('uncertain');
          }
        } else {
          // Un seul visage - OK
          _absenceCount = 0;
          _multiPersonCount = 0;
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
  function triggerWarning(isTyping) {
    if (_isWarningActive) return;

    _isWarningActive = true;
    _countdownValue = 5;
    _overlay.style.display = 'flex';
    updateTimerUI();

    _countdownTimer = setInterval(() => {
      _countdownValue--;
      updateTimerUI();

      // Alerte sonore modulée selon le contexte
      if (typeof window.playBip === 'function') {
        const freq = isTyping ? 440 : 880; // Fréquence plus grave/discrète si on frappe
        const vol = isTyping ? 0.05 : 0.2; // Volume réduit si on frappe
        window.playBip(freq, 0, 0.08, vol, 'sine');
      }

      if (_countdownValue <= 0) {
        infractionDetected("Absence prolongée (+5 s) détectée par l'IA.");
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

  // Écouteur global de frappe pour la corrélation
  document.addEventListener('keydown', () => {
    _lastTypingTime = Date.now();
  }, { passive: true });

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
