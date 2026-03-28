#!/bin/bash
# Script pour générer automatiquement le package SCORM Moodle

echo "🚀 Préparation de la génération du package SCORM..."

# Créer le répertoire de build s'il n'existe pas
mkdir -p build

# Archiver les fichiers nécessaires dans le fichier zip
# (Le -u met à jour les fichiers existants si le zip est déjà là)
zip -r build/editeur_antiplagiat_scorm.zip index.html config.json scorm_api.js ai_monitor.js imsmanifest.xml

echo "✅ Package SCORM généré avec succès :"
echo "📂 build/editeur_antiplagiat_scorm.zip"
