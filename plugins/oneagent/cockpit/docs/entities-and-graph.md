# Entities and the memory graph

An entity is a real subject you want OneAgent to organize information around: a product, person, team, project, feature, initiative, repository, mission, or another type used in your workspace.

## Entities are the filing system

Notes, captures, tasks, decisions, risks, and questions can be linked to an entity. This answers a practical question: “What does this information concern?”

Use:

- one **primary entity** for the main subject;
- related entities when the same item also informs, impacts, supports, blocks, or concerns something else.

An accepted piece of sourced information can enrich an existing entity. It does not create a new entity automatically.

## Relationships form the graph

A relationship explains how two entities are connected, for example:

- a person **owns** a feature;
- a task **concerns** a product;
- a product **depends on** another product;
- an initiative **supports** a mission.

The graph is a map of these entities and relationships. It is not a folder tree, so the same entity can participate in several useful paths.

## Retrouver une entité ou un document

Dans **Mémoire → Liste**, rechercher un titre ou un nom de fichier et filtrer par
type ou entité liée. Le bouton **Markdown** ouvre directement la page locale.
La liste reste complète même lorsque le graphe limite ses nœuds visibles.
Voir les [vues enregistrées de la mémoire](graph-views.md).

### Combiner des critères dans la recherche

La même barre de recherche sert au tableau et au graphe. Un mot seul cherche
dans le nom, les alias, la description, les tags et la chaîne des parents :
`bcp` trouve aussi les équipes et projets rangés sous BCP. Les critères se
combinent, et un résultat doit tous les respecter :

| Critère | Garde |
|---|---|
| `tag:bcp` | les entités dont un tag contient « bcp » |
| `type:personne` | un type d'entité (équipe, projet, personne, tâche…) |
| `équipe:1FF`, `projet:"Refonte checkout"`, `domaine:BCP`… | le périmètre de cette entité |
| `dans:X` | le périmètre de n'importe quelle entité nommée X |
| `source:"Organigramme BCP"` | ce qui vient de ce document ou y est lié |

Une virgule veut dire « l'un ou l'autre » (`équipe:1FF,2FF`), un `-` exclut
(`-type:tâche`), les guillemets gardent les espaces. Exemple :
`type:personne tag:bcp équipe:1FF`.

Le **périmètre** d'une entité, c'est tout ce qui est rangé sous elle, à toute
profondeur (contient, fait partie de, possède, rattaché à, parent), puis ce qui
est directement relié à cet ensemble : personnes, décisions, risques, tâches.
Dans le graphe, un clic droit sur un nœud propose **Afficher le périmètre**,
et sur une capture **Afficher ce qui vient de ce document**.

Pendant la saisie, la barre propose les tags, types, entités et documents
existants. **Épingler dans la vue** garde la recherche comme filtre de la vue
enregistrée ; elle apparaît en pastille « Recherche » et se retire d'un clic.

## Travailler avec le graphe

1. Ouvre **Mémoire** et choisis une vue en graphe (ou bascule la vue en **Graphe**).
2. Cherche ou combine des critères dans la barre, ou ouvre **Filtres**.
3. Clique sur un nœud pour ouvrir sa fiche ; clic droit pour **Afficher le périmètre**.

### Filtres

Le bouton **Filtres** ouvre et referme un tiroir à droite du graphe (Échap ou
**Voir le graphe** le ferment aussi). Son chiffre indique les filtres actifs.

- **Recherche du tiroir** : un groupe (« organisation ») garde ce groupe, un type
  (« personne ») propose de choisir parmi ses valeurs, une valeur (« OneFF ») liste
  directement **Équipes › OneFF**, **Produits › OneFF**… à cocher.
- **Raccourcis** : **Tout** affiche tout, un second clic masque tout pour ne garder
  ensuite que quelques types ; **Moi** garde ce qui te concerne (ton périmètre, ce
  dont tu es responsable ou contributeur, ta mission, tes tâches et tes notes, comme
  la recherche `moi:`) ; **Organisation**, **Produit & delivery**, **Pilotage** ;
  **Sans le bruit** masque sources, questions, concepts et découvertes.
- **Types** : en pastilles groupées. Un clic sur la pastille affiche ou masque le
  type ; **›** ouvre ses valeurs (recherche, tout cocher, tout décocher,
  seulement la recherche). Une pastille « 2/6 » en pointillés est filtrée en partie.
  **tout · rien** agit sur un groupe.
- **Relations** et **Focus et niveau** sont repliés en bas du tiroir.

### Fiche d’une entité

Toutes les fiches ont la même structure :

- **En-tête** : type, statut, titre, description entière et faits clés (rattachement
  « BCP › Plateforme », période, responsable). Les icônes modifient la fiche,
  centrent le graphe, affichent le périmètre, ouvrent la page Markdown ; **⋯**
  propose l’espace de travail, une note ou une capture.
- **Synthèse** : d’abord le bloc propre au type (résultats clés d’un OKR avec leur
  avancement, dernière mesure d’un KPI, OKR d’une mission, besoin d’une demande tiré
  de sa page, ce que porte une équipe et ses membres, dépôts et fonctionnalités d’un
  produit, cycle d’une découverte…), sinon un extrait de la page ; puis **Lié à**,
  regroupé par sens de la relation, chaque entité ouvrant sa propre fiche ; puis
  **À faire**, **Points d’attention** et **Dernières décisions**.
- **Liens**, **Activité** (observations et captures) et **Document** (la page
  Markdown, sans son en-tête technique).
- Les compteurs (liens, observations, captures, tâches) en bas de la fiche.

You can add or edit entities and relationships from **Settings → Actions et diagnostics → Knowledge**. Deleting or merging can affect several linked items, so read the confirmation carefully.

## Créer une entité depuis le chat Copilot

Depuis Copilot 0.6.26, une demande comme « Crée une entité pour cette étude avec son contenu et relie-la à OneFF » peut être exécutée directement par l’agent. Il consulte les types disponibles et les entités existantes, crée le sujet avec sa propre page Markdown, puis ajoute sa relation au produit. Une étude fonctionnelle peut être classée comme `discovery`, avec une relation `scoped_to` vers le produit. Il ne faut pas remplacer cette demande par une simple note sur OneFF.

Les outils sont `oneagent_get_taxonomy`, `oneagent_create_entity`, `oneagent_list_relations` et `oneagent_upsert_relation`. La création refuse un ID déjà utilisé. Pour réviser le document d’une entité existante, l’agent peut proposer un document dans l’Inbox, à relire avant acceptation. Une suggestion issue d’une source ne déclenche pas une création automatique. Le contexte strict reste respecté : si la création est refusée pour ce motif, choisir Tout/Reset ou adapter le contexte, puis reprendre dans le même chat.

The graph and memory table use the full page width. A node click in Navigate mode, or **Fiche** in the table, opens a large detail window. Close it with **Fermer** or Escape to return to the same view. Unsaved edits are protected. Context selection stays directly on the graph without opening a detail window.

## Keep the graph useful

- Reuse an existing entity instead of creating a near-duplicate.
- Give entities clear names and short descriptions.
- Choose a relationship that explains the connection, not just “related” when a precise option exists.
- Archive entities that are no longer operational rather than deleting useful history.

The graph helps you navigate knowledge. To save a reusable visual arrangement, use a [Graph View](graph-views.md). To control what the agent may use, configure the [Active Context](active-context.md).
