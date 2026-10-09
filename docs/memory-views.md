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

**Tout** et **Réinitialiser** enlèvent les filtres, la recherche, le focus, les
regroupements manuels et le contexte actif. L’agent retrouve toute la mémoire
connectée dès ses prochains appels, dans la même conversation. Les documents
ajoutés plus tard sont également accessibles ; aucune liste figée de nœuds n’est
utilisée comme permission. Les vues sauvegardées restent intactes.

**+ Vue** crée une vue avec accès à toute la mémoire. Une vue peut orienter le
travail de l’agent sans interdire la consultation d’un document complémentaire.
Dans **Contexte**, **Limiter à cette sélection** est un choix explicite : préparer
la sélection puis l’activer/enregistrer. Les anciennes vues strictes conservent
leur restriction. Choisir une vue applique son contexte enregistré ; une vue sans
contexte ne conserve jamais la restriction de la vue précédente.

L’indicateur **Accès agent : toute la mémoire / limité à…** décrit le contexte
réel du moteur, indépendamment d’un brouillon en cours d’édition. Le Reset attend
la confirmation du moteur ; en cas d’erreur, la restriction précédente reste
indiquée. Le contexte est partagé par les hôtes branchés sur la même mémoire.
Il ne retire pas les informations déjà présentes dans l’historique du chat.

Le graphe humain charge tous les nœuds et liens, sans seuil de 500/1 000 éléments.
Les filtres et regroupements explicites restent disponibles. Le moteur Canvas
conserve les positions, adapte les libellés et regroupe les rafraîchissements.
La liste et les menus de filtres affichent progressivement leurs résultats.
Les requêtes de graphe destinées à l’agent peuvent toujours demander un extrait.

Le budget **Automatique** remplace le plafond fixe par défaut. Un budget **Manuel**
reste possible dans les réglages avancés de Contexte. Les budgets positifs des
anciennes vues sont conservés. La capacité du modèle et les limites de transport
de l’hôte s’appliquent toujours ; un document entier peut être lu par sections.

Voir aussi : [entités et graphe](entities-and-graph.md),
[contexte actif](active-context.md), [Context Packs](context-packs.md).
