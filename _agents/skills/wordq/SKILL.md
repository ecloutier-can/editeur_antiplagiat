---
name: wordq
description: Expertise sur l'outil d'aide technologique WordQ et son intégration avec l'éditeur anti-plagiat.
---

# Skill: WordQ (Aide technologique)

## Qu'est-ce que WordQ ?
WordQ est un logiciel d'aide à l'écriture et à la lecture (développé par Quillsoft) extrêmement répandu dans les institutions d'enseignement. Il aide les étudiants ayant des difficultés de lecture ou d'écriture (dyslexie, dysorthographie, limitations motrices).

## Fonctionnalités clés à considérer pour ce projet
1. **Prédictions de mots :** Affiche une liste de mots suggérés au fur et à mesure de la frappe.
   - *Impact technique :* L'insertion d'un mot choisi dans la liste peut être perçue par l'éditeur comme une modification rapide ou un événement "insertText". Comme pour Lexibar, il ne faut pas que notre système anti-tricherie confonde cette aide légitime avec un collage (`paste`) de bloc de texte.
2. **Rétroaction vocale (TTS) :** Lit les mots ou phrases tapés pour permettre à l'étudiant de s'auto-corriger.
   - *Impact technique :* Notre ajout récent de synthèse vocale native (Phase 21) offre une alternative directe, ce qui permet de désactiver les accès externes si nécessaire sans bloquer l'étudiant.
3. **Talk-to-Type (SpeakQ) :** Permet la dictée vocale.
   - *Impact technique critique :* La dictée vocale injecte du texte par blocs. Si l'étudiant dicte une phrase complète, l'éditeur verra arriver 15 mots d'un coup. Notre algorithme de détection de vitesse de frappe (si implémenté) doit être capable de faire la différence entre une dictée assistée et un script de triche.
4. **Mode Examen (Exam Mode) :** Une version restreinte de WordQ pour limiter les fonctionnalités (ex: désactiver l'accès web).
5. **Intégration Chrome :** WordQ pour Chrome est une application web distincte, tandis que la version Desktop est une barre flottante qui communique avec les champs de texte.

## Règles d'intégration au projet

> [!IMPORTANT]
> **Règle d'or (Sécurité Maximale) :** NE JAMAIS ouvrir l'application à WordQ ou SpeakQ. Toute injection de texte externe est une brèche de plagiat potentielle. Si une fonction d'aide est requise par l'étudiant, elle doit être **ré-implémentée nativement** dans notre "coquille" sécurisée.

- **Vigilance sur l'injection de texte :** WordQ utilise souvent des mécanismes d'accessibilité système pour injecter du texte. Nos écouteurs d'événements `beforeinput` et `input` doivent être robustes.
- **Différenciation Dictée vs Plagiat :** Si nous mesurons la cadence de frappe, nous devons prévoir un profil "Dictée" qui accepte des rafales de texte suivies de pauses.
- **Priorité à l'interne :** Toujours encourager l'utilisation de nos outils natifs (comme notre lecteur vocale Phase 21) car ils sont garantis sans fuite de données et n'interfèrent pas avec le DOM.


## Comment invoquer ce skill
Consulte ce fichier dès qu'une modification touche à la saisie de texte ou à l'accessibilité. WordQ est plus complexe que Lexibar car il inclut la dictée vocale (`SpeakQ`), ce qui est un défi de taille pour un éditeur qui surveille la provenance du texte.
