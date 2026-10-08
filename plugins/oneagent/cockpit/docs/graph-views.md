# Vues de la mémoire : graphe et liste

**Mémoire** propose deux affichages du même espace de travail. Le graphe aide à
explorer les relations. La liste permet de retrouver un élément ou son fichier
sans devoir le repérer parmi les nœuds. La liste inclut également les pages et
sources rattachées aux entités, même si elles ne sont pas dessinées comme nœuds.

## Retrouver une information

1. Ouvrir **Mémoire**, puis **Liste**.
2. Chercher un titre, une description, un nom de fichier, une entité ou une URL.
   La recherche ignore les accents et la casse ; chaque mot saisi doit correspondre.
3. Dans **Filtres**, cocher un ou plusieurs types et/ou entités liées.
   Les choix sont issus des résultats, en tenant compte des autres filtres.
   Plusieurs valeurs d’un champ sont combinées par OU ; les champs par ET.
4. Cliquer sur le titre pour ouvrir la fiche ou l’éditeur de tâche/note.
   **Markdown/Fichier** ouvre directement le fichier ; **Source** ouvre le lien.

Le catalogue n’est pas limité par le nombre de nœuds du graphe. Il couvre les
entités, chaque page du wiki, les sources connues (dont Google Docs et Sheets),
les notes et les tâches. Il n’effectue aucune recherche distante dans Google Drive
et ne recherche pas dans le corps complet de tous les documents. Les pages des
dépôts sont accessibles si ces dépôts sont configurés dans la mémoire.

## Enregistrer une vue

Les vues sont des onglets ; **Toutes les vues** reste disponible lorsque la
fenêtre est étroite. **+ Vue** enregistre l’état courant sous un nom, par exemple
« Documents OneFF » ou « Équipe DKT FF ».

Une vue conserve l’affichage (graphe ou liste), les filtres, le tri et son sens,
le regroupement par type et les propriétés visibles de la liste. Elle conserve
également les anciens paramètres du graphe : perspective, disposition et focus.
Les vues déjà enregistrées restent des vues graphe.

Les modifications sont temporaires jusqu’à **Enregistrer**. Le menu **…** permet
de rétablir la vue, l’enregistrer sous un autre nom, la renommer, la dupliquer ou
la supprimer. Supprimer une vue ne supprime pas les éléments de la mémoire.
La recherche ponctuelle n’est pas enregistrée dans les nouvelles vues ; les anciennes
vues ayant une recherche peuvent encore la réappliquer à leur ouverture.

## Utiliser une petite fenêtre

La barre sépare vues et outils. Les réglages avancés du graphe sont regroupés dans
**Affichage** et **Filtres**. Les propriétés des lignes passent sous leur titre.
La fiche s’ouvre en panneau superposé : **Retour aux résultats** ou Échap permet
de retrouver la liste et ses filtres. Aucun bouton n’a besoin de se chevaucher.

## Vue et contexte de l’agent (Active Context)

Une vue filtre l’affichage humain. Changer de vue ou rechercher un document
n’active, n’élargit ni ne supprime le contexte de l’agent. Les vues existantes
peuvent conserver un brouillon de contexte ; son activation reste explicite
via **Contexte**. Les Context Packs restent les informations effectivement
préparées pour une demande de l’agent.

Voir aussi : [entités et graphe](entities-and-graph.md),
[contexte actif](active-context.md), [Context Packs](context-packs.md).
