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

## Work with the graph

1. Open **Memory graph**.
2. Use **Overview** for the wider map, **Focus** around one entity, or **Dependencies** around related products.
3. Keep **Navigate** selected and click a node.
4. Read its summary, linked information, tasks, sources, and relationships in the detail window.
5. Use the search field or filters when the graph is busy.

When the selected entity has a Markdown page, **Open Markdown** opens its main page directly in the VS Code editor. Use the **Content** tab to open a specific page when the entity has several. The button is hidden when there is no page available or the active context does not allow access to its file.

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
