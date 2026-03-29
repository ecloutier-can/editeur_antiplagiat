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
  let _multiPersonCount = 0; 
  let _absenceCount = 0;    // Nouveau: Compteur pour l'absence contextuelle
  let _lastTypingTime = 0;  // Nouveau: Horodatage de la dernière frappe
  
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
    
    // Nettoyer les classes IA
    _statusEl.classList.remove('off', 'ai-searching', 'ai-success', 'ai-warn', 'ai-uncertain');
    
    let labelText = "";
    switch(state) {
      case 'searching':
        _statusEl.classList.add('ai-searching');
        labelText = " IA : Analyse...";
        break;
      case 'success':
        _statusEl.classList.add('ai-success');
        labelText = " IA : Visage OK";
        break;
      case 'uncertain':
        _statusEl.classList.add('ai-uncertain');
        labelText = " IA : Présent ?";
        break;
      case 'warn':
        _statusEl.classList.add('ai-warn');
        labelText = " IA : Absence !";
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
            if (calculateIOU(predictions[i], filtered[j]) > 0.4) { // Seuil IOU à 40%
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
        _aiVideo.play().catch(() => {});
      }

      if (_aiVideo.paused || _aiVideo.readyState < 2 || _aiVideo.videoWidth === 0) {
        _aiVideo.play().catch(() => {});
        return;
      }

      // 3. Délai de grâce initial
      if (Date.now() - _startTime < 3000) return;

      // 4. Contexte de frappe (Proposition 1)
      const isTyping = (Date.now() - _lastTypingTime < 5000);

      try {
        // 5. Estimation BlazeFace
        const predictions = await _model.estimateFaces(_aiVideo, false);
        
        let validFaces = predictions.filter(p => {
          const score = Array.isArray(p.probability) ? p.probability[0] : p.probability;
          return score > 0.5;
        });

        validFaces = filterDuplicates(validFaces);

        // --- NOUVELLE LOGIQUE CONTEXTUELLE (Propositions 1 & 4) ---
        if (validFaces.length === 0) {
          _absenceCount++;
          const threshold = isTyping ? 4 : 2; // Plus permissif si l'étudiant tape (v23)
          
          if (_absenceCount >= threshold) {
            updateStatusUI('warn');
            triggerWarning();
          } else {
            updateStatusUI('uncertain'); // État Orange (Proposition 4)
            console.log("🤖 IA: Présence incertaine (" + _absenceCount + "/" + threshold + ")");
          }
        } else if (validFaces.length > 1) {
          _multiPersonCount++;
          _absenceCount = 0; 
          if (_multiPersonCount >= 2) {
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

  // Écouteur global de frappe pour la corrélation (Proposition 1)
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
