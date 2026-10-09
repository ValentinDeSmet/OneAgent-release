# Vues de la mémoire : tableau et graphe

**Mémoire** permet de retrouver tous les éléments connus et leurs documents.
**Toute la mémoire** ouvre un tableau sans filtre. Les vues enregistrées ont un
nom et un type choisi à leur création : **Tableau** pour retrouver des documents,
**Graphe** pour explorer leurs relations.

## Rechercher et filtrer dans le tableau

La recherche générale porte sur les titres, descriptions, noms de fichiers,
entités liées et URL. Elle ignore les accents et la casse ; chaque mot saisi doit
correspondre. Elle reste temporaire et ne modifie pas la vue enregistrée.

Le tableau occupe toute la largeur. Les colonnes par défaut sont **Titre**,
**Type**, **Entités liées**, **Dernière modification** et **Ouvrir**. **Colonnes**
permet d’ajouter **Création**, **Statut** et **Emplacement / source**, de masquer
les propriétés inutiles et de réorganiser les colonnes. Les en-têtes se déplacent
également par glisser-déposer ; leur bord droit permet de régler la largeur.
Des boutons et les flèches du clavier proposent les mêmes réglages.

- Cliquer sur un en-tête de données pour trier, puis inverser le sens du tri.
- Cliquer sur son icône de filtre pour filtrer cette colonne.
- **Type**, **Entités liées** et **Statut** proposent une recherche et des cases
  à cocher. Les valeurs et compteurs viennent des résultats tenant compte des
  autres filtres. Plusieurs valeurs d’une colonne sont combinées par OU ; les
  colonnes par ET. Un choix déjà coché reste disponible même avec zéro résultat.
- **Titre** et **Emplacement / source** proposent un texte puis **Appliquer**.
  Les colonnes de dates proposent une période de début et de fin.
- L’icône indique les filtres actifs. **Effacer le filtre de cette colonne**
  permet de les retirer, y compris lorsque le tableau est vide. Une colonne
  filtrée reste visible tant que son filtre n’a pas été effacé.

Les dates inconnues affichent un tiret, restent en fin de tri et sont exclues
lorsqu’une période est filtrée. Une date d’import ne remplace pas une date de
création ou de modification inconnue. Les résultats sont paginés par 80 lignes ;
la recherche, les filtres et le tri portent sur le catalogue complet.

## Sélectionner et ouvrir

Cliquer sur une ligne la sélectionne. Les cases à cocher et Cmd/Ctrl-clic
permettent une sélection multiple, conservée pendant le tri et le filtrage.
**Markdown/Fichier** ouvre le document dans l’hôte ; **Source** ouvre son URL.
**Fiche**, **Note** ou **Tâche** ouvre explicitement les détails correspondants.
Aucun panneau vide ne réserve de place à droite. Une fiche d’entité s’ouvre
au-dessus du tableau ; **Retour aux résultats** ou Échap la referme.

Ces sélections et ouvertures ne modifient jamais le contexte de l’agent.

Le catalogue couvre les entités, les pages Markdown, les sources connues (dont
Google Docs et Sheets), les notes et les tâches. Il n’effectue aucune recherche
distante dans Google Drive ni dans le corps complet des documents. Les dépôts
sont accessibles lorsqu’ils sont configurés dans la mémoire.

Les représentations qui pointent avec certitude vers le même fichier sont
regroupées dans une ligne, avec leurs types et leurs liens. Leurs autres titres
restent recherchables. Deux fiches métier distinctes ou deux fichiers portant le
même titre ne sont pas fusionnés. Ce regroupement d’affichage ne supprime aucune
donnée.

## Créer et enregistrer une vue

**+ Vue** demande un nom et un type **Tableau** ou **Graphe**. La nouvelle vue
commence sans filtre, avec accès à toute la mémoire. Le menu **…** permet de
**Dupliquer en tableau** ou **Dupliquer en graphe** une vue existante en conservant
ses filtres, son tri et son contexte explicite ; la vue d’origine reste intacte.
Il n’y a plus de bascule Tableau/Graphe permanente dans la barre d’outils.

Chaque vue conserve ses filtres de colonnes, le tri et son sens, le regroupement,
les colonnes visibles, leur ordre et leur largeur, ainsi que les paramètres du
graphe et son contexte. Les modifications restent temporaires jusqu’à
**Enregistrer**. **Rétablir la vue** récupère les réglages sauvegardés. Renommer,
dupliquer ou supprimer une vue ne supprime pas les éléments de la mémoire.

Les onglets et **Toutes les vues** donnent accès aux vues sauvegardées. Les
anciennes vues conservent leurs réglages et leur type. Une ancienne vue nommée
« All » ou « Tout » apparaît comme **Vue générale — graphe/tableau** pour la
distinguer de **Toute la mémoire** ; son nom stocké et son contexte restent intacts.

## Vue et contexte de l’agent (Active Context)

**Toute la mémoire** enlève les filtres, la recherche, le focus, les regroupements
manuels et le contexte actif. L’agent retrouve toute la mémoire connectée dès ses
prochains appels, dans la même conversation. Les nouveaux documents restent
accessibles ; aucune liste figée de nœuds ne sert de permission. Les vues
sauvegardées restent intactes.

Choisir une vue applique son contexte enregistré. Une vue sans contexte ne
conserve jamais la restriction précédente. Les anciennes vues strictes gardent
leur restriction. **Contexte**, dans le menu de la vue, permet de préparer une
sélection puis de la limiter explicitement et de l’enregistrer.

**Accès agent : toute la mémoire / limité à…** décrit le contexte réel du moteur,
indépendamment du brouillon. La réinitialisation attend sa confirmation ; en cas
d’erreur, la restriction précédente reste indiquée. Le contexte est partagé entre
les hôtes connectés à la même mémoire. Le réinitialiser ne retire pas les
informations déjà présentes dans l’historique du chat.

Le graphe charge tous les nœuds et liens sans seuil de 500/1 000 éléments. Canvas
conserve les positions, adapte les libellés et regroupe les rafraîchissements.
Les filtres d’un tableau dupliqué en graphe restent visibles sous forme de pastilles
supprimables. Les réglages du graphe se trouvent dans **Affichage** et **Filtres**.

Le budget **Automatique** remplace le plafond fixe par défaut. Un budget **Manuel**
reste possible dans les réglages avancés de Contexte. Les budgets positifs des
anciennes vues sont conservés. La capacité du modèle et les limites de transport
de l’hôte s’appliquent toujours ; un document entier peut être lu par sections.

Voir aussi : [entités et graphe](entities-and-graph.md),
[contexte actif](active-context.md), [Context Packs](context-packs.md).
