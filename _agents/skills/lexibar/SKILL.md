---
name: lexibar
description: Expertise sur l'outil d'aide technologique Lexibar et son intégration avec l'éditeur anti-plagiat.
---

# Skill: Lexibar (Aide technologique)

## Qu'est-ce que Lexibar ?
Lexibar est un logiciel d'aide technologique québécois très utilisé dans le milieu de l'éducation. Il est conçu pour les étudiants ayant des troubles d'apprentissage (dyslexie, dysorthographie, dysphasie). 
Il fonctionne en arrière-plan (overlay) et interagit directement avec les zones de texte du navigateur.

## Fonctionnalités clés à considérer pour ce projet
1. **Synthèse vocale :** Lit à voix haute le texte sélectionné ou tapé. 
   - *Impact technique :* Assurez-vous que le texte tapé dans le `#ed` (contenteditable) est lisible par les outils d'accessibilité (ARIA).
2. **Prédicteur orthographique et phonétique :** Suggère des mots au fur et à mesure de la frappe. Lorsque l'étudiant clique sur une suggestion, Lexibar insère le mot complet dans le champ de texte.
   - *Impact technique critique (Anti-Plagiat) :* L'insertion d'un mot par Lexibar pourrait déclencher des événements JavaScript imprévus. Si Lexibar utilise une simulation de `paste` ou `execCommand('insertText')`, notre système anti-plagiat pourrait bloquer l'action ou l'enregistrer comme une infraction (collage). Il faut s'assurer que ces insertions sont soit tolérées (car ce sont des mots individuels), soit injectées via des événements de frappe standard (`InputEvent`).
3. **Vérificateur orthographique :** Analyse les mots et utilise un code couleur (vert, bleu, rouge).
   - *Impact technique :* S'il modifie le DOM en insérant des balises `<span>` colorées dans notre `<div id="ed" contenteditable="true">`, cela pourrait altérer le décompte des mots ou polluer l'exportation `.plagiat`. 

## Règles d'intégration au projet
Lorsque tu travailles sur l'application `editeur_antiplagiat` et que tu dois implémenter ou débugger des systèmes touchant à la frappe de l'étudiant :

> [!IMPORTANT]
> **Règle d'or (Sécurité Maximale) :** NE JAMAIS assouplir la sécurité pour Lexibar. Toute fonctionnalité de Lexibar jugée essentielle (ex: lecture vocale) doit être **implémentée nativement** à l'intérieur de notre "coquille" protégée (ex: Phase 21). L'application doit rester hermétique aux injections externes.

- **Toujours penser "Faux Positif" :** Avant de durcir les règles anti-triche (ex: vitesse de frappe anormale, collage bloqué), pose-toi la question : *"Est-ce que Lexibar ou un autre prédicteur de mots pourrait déclencher cette alerte par erreur en insérant rapidement un mot de 12 lettres ?"*
- **Compatibilité du DOM :** Ne t'attends pas à ce que le contenu du `#ed` ne contienne que du texte pur. Des logiciels d'assistance peuvent injecter des marqueurs DOM. La fonction d'extraction de texte (ex: `innerText` vs `innerHTML`) doit en tenir compte.
- **Accessibilité :** Ne désactive jamais les attributs globaux qui permettent à Lexibar de s'ancrer au texte (garde la sémantique de base des `contenteditable` ou `textarea`).


## Comment invoquer ce skill
Ce fichier sert de mémoire persistante. Lorsque tu dois résoudre un conflit entre l'éditeur et un logiciel d'aide, tu dois t'y référer pour te remémorer les interférences potentielles (Dom poisoning, faux-positifs de collage, etc.).
