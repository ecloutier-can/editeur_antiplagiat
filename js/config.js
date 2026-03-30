/**
 * CONFIGURATION DE L'ÉDITEUR DE CONFIANCE
 * Ce fichier contient les paramètres de sécurité et les objectifs pédagogiques.
 */

// Clé d'obfuscation pour les fichiers .plagiat (Sauvegarde locale)
// IMPORTANT : Ne pas modifier si vous souhaitez rester compatible avec les anciens fichiers.
const _OB_KEY = "AntiTricheEdition2026!";

// Objectif de mots (0 = pas d'objectif)
// Ex: 300 pour exiger ou suggérer 300 mots.
const _wordGoal = 0;

// Configuration par défaut (sera surchargée par SCORM ou config.json)
const DEFAULT_CONFIG = {
  "appName": "Veritas — Éditeur de confiance",
  "security": {
    "blockContextMenu": true,
    "blockShortcuts": ["F12", "Control+U", "Control+P", "Meta+P", "Control+Shift+I"],
    "typingSpeedLimit": 500,
    "heartbeatInterval": 5000,
    "enableScreenCapture": true,
    "autoDownloadInterval": 1800000,
    "enableAI": true,
    "aiScanInterval": 4000,
    "aiWarningDuration": 5000
  },
  "pedagogy": {
    "enableTimeline": true,
    "timelineSnapshotInterval": 60000,
    "authorizedPauseDuration": 300000,
    "allowedResources": [
      { 
        "id": "usito",
        "title": "Dictionnaire Usito", 
        "author": "Université de Sherbrooke",
        "description": "Dictionnaire de la langue française qui tient compte du contexte québécois et canadien.",
        "url": "https://usito.usherbrooke.ca/",
        "icon": "book"
      },
      { 
        "id": "conjugueur",
        "title": "Le Conjugueur", 
        "author": "Le Figaro",
        "description": "Outil complet pour vérifier la conjugaison de tous les verbes de la langue française.",
        "url": "https://leconjugueur.lefigaro.fr/",
        "icon": "edit-3"
      }
    ]
  },
  "ui": {
    "glassmorphism": true,
    "autoSaveIndicator": true,
    "connectionStatusIndicator": true
  },
  "messages": {
    "connectionLost": "⚠️ Connexion avec le serveur perdue. Vos modifications sont sauvegardées localement.",
    "suspiciousTyping": "⚠️ Vitesse de saisie inhabituelle détectée.",
    "demoModeActive": "🚀 Mode Démo (GitHub) : Les données sont stockées localement uniquement."
  }
};

// Export pour utilisation dans app.js
if (typeof window !== 'undefined') {
  window._OB_KEY = _OB_KEY;
  window._wordGoal = _wordGoal;
  window.DEFAULT_CONFIG = DEFAULT_CONFIG;
}
