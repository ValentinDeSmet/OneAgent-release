# Changelog

## 0.1.142

- Priorités adopte le tableau et les vues de Mémoire, avec les mêmes contrôles de colonnes et styles partagés avec Copilot 0.6.19.
- Colonnes masquables, ordre par glisser-déposer ou clavier, largeur réglable, filtres recherchables dans les en-têtes et présentation enregistrée par vue.
- Onglets, sélecteur Toutes les vues, création sans filtre et Enregistrer sous pour copier les réglages courants ; anciennes vues conservées.
- Classement manuel, révisions des écritures, tâches en accordéon et retrait sans suppression de tâche conservés. L’agent et les exports privés préservent les réglages de colonnes.

## 0.1.141

- Tableau Mémoire pleine largeur partagé avec Copilot 0.6.18 : en-têtes triables, filtres de colonnes recherchables à cases multiples, compteurs contextuels, dates et texte.
- Colonnes optionnelles, largeur réglable et ordre par glisser-déposer ou clavier, conservés avec les filtres et le tri dans chaque vue.
- Création de vues Tableau/Graphe et duplication entre affichages ; Toute la mémoire distincte des anciennes vues All/Tout conservées.
- Sélection de lignes indépendante du contexte, ouvertures explicites des Markdown, liens et fiches, sans panneau vide permanent.
- Regroupement des représentations certaines d’un même fichier sans fusion par titre ni suppression ; dates inconnues laissées vides et pagination du catalogue complet.

## 0.1.140

- Tout et Réinitialiser effacent aussi le contexte actif ; création d’une vue avec accès à toute la mémoire et indicateur de l’accès réel de l’agent.
- Sélection d’une vue avec application de son contexte enregistré ; anciennes vues strictes conservées, erreurs de changement signalées sans faux succès.
- Graphe sans plafonds de nœuds/liens ni repli automatique ; Canvas prioritaire, positions conservées, rafraîchissements regroupés et facettes progressives.
- Budget automatique par défaut, réglage manuel explicite, découverte et lecture des Markdown/notes/sources par sections avec curseur et contrôle de révision, sur les deux hôtes.

## 0.1.139

- Espace Mémoire commun avec Copilot 0.6.16 : graphe et liste, vues enregistrées par affichage, filtres multiples par type et entité liée, tri, regroupement et propriétés visibles.
- Catalogue indépendant des limites du graphe : entités, pages Markdown, sources et liens Google Docs/Sheets, notes et tâches. Recherche textuelle dans les titres, descriptions, chemins et liens connus.
- Ouverture directe des fichiers dans l’éditeur de chaque hôte ; les liens source utilisent leur URL. Les recherches ponctuelles restent temporaires et les anciennes vues sont conservées.
- Barre allégée, menus de réglages et sélecteur de vues compact. La fiche devient un panneau superposé avec retour sur fenêtre étroite.

## 0.1.138

- Vues enregistrées des priorités, communes à Copilot 0.6.14 : onglets, filtres multiples, recherche, tri et sens du tri.
- Création, mise à jour explicite, renommage, duplication, suppression de la vue seule et choix d’une vue d’ouverture par défaut.
- Indicateur Modifiée pour les filtres temporaires ; réapplication des critères sauvegardés. Les listes restent dynamiques et Mon classement conserve le rang global.
- Révisions partagées contre les modifications concurrentes, maintien des brouillons après une erreur et conservation des vues dans les sauvegardes/exports privés. Outils agent identiques dans les deux plugins.

## 0.1.137

- Priorités communes avec Copilot 0.6.13 : périodes Q1–Q4 et année en listes déroulantes, sans nouvelles périodes libres. Conservation des anciennes périodes ambiguës jusqu’à conversion explicite.
- Colonne Type de travail triable et filtres multiples Type de travail, Trimestre et Année issus des sollicitations affichées.
- Accordéon Tâches par priorité : création, rattachement d’une tâche existante, édition et détachement. La même tâche reste visible dans Tâches, sans duplication ni inscription automatique aux priorités.
- Gestion des priorités liées depuis la fiche Tâches, outils agent identiques dans les deux hôtes, contrôle transactionnel des révisions et préservation des liens lors des éditions ordinaires.

## 0.1.136

- Priorités explicites dans VS Code et Copilot 0.6.12 : une tâche ordinaire reste hors de la liste, des compteurs, des filtres et du classement, même avec une urgence élevée ou une échéance.
- Action **Ajouter aux priorités** dans la fiche d’une tâche personnelle : rattachement à une entité existante, conservation de la même tâche, de ses informations et de tous ses liens.
- Action inverse **Retirer des priorités** sans suppression ni archivage de la tâche. Les priorités déjà créées et les éléments précédemment retirés restent disponibles.
- Outils agent pour lire les tâches et ajouter explicitement une tâche existante aux priorités, avec contrôle de révision et respect du contexte strict.

## 0.1.135

- Inbox Markdown (Copilot 0.6.10) : proposition d’un document par l’agent, aperçu formaté, édition et acceptation explicite dans le cockpit partagé.
- Publication privée et recherche SQLite FTS, sans embeddings. La proposition ne modifie aucun fichier avant validation.
- Contrôle des révisions du brouillon et du document cible ; conservation des corrections lors d’un échec d’enregistrement.
- Nouveaux outils pour proposer, lister, lire et corriger les documents en attente. La curation automatique reste soumise à la validation des observations.

## 0.1.134

- Correction du retrait des priorités (Copilot 0.6.9) : la tâche native reste dans
  Tâches avec son état, ses informations et tous ses liens.
- Indicateur de présence indépendant du statut, exclu des compteurs, facettes
  et du classement. Les éditions ordinaires ne réactivent pas la priorité.
- Actions de ligne compactes : crayon et menu ⋯, avec confirmation de retrait.
- Vue « Retirées des priorités » et remise en liste de la même tâche, disponible
  aussi pour l’agent avec contrôle de révision.

## 0.1.133

- Priorités communes à VS Code et Copilot 0.6.8 : filtres à cases à cocher,
  sélection multiple et recherche dans les choix présents dans les sollicitations.
- Choix et compteurs calculés avant pagination, en tenant compte des autres
  filtres. Les choix de création conservent toutes les entités disponibles.
- Suppression explicite d’une sollicitation depuis la ligne ou la fiche, sans
  la marquer terminée. L’entité, les sources et les notes liées sont conservées.
- Suppression transactionnelle avec contrôle de révision, disponible aussi
  pour l’agent sur demande explicite, et sans répétition automatique en cas d’erreur.

## 0.1.132

- Suppression de BMAD Readiness dans les deux plugins (Copilot 0.6.6) : score
  dans l’en-tête, indicateur et carte Today, outil agent, commande et calcul CLI.
- Nettoyage des styles, exemples, prototypes et instructions associés. Les
  questions, risques, tâches, priorités et imports BMAD restent disponibles.

## 0.1.131

- Classement manuel des priorités par glisser-déposer, affiché par défaut et
  commun à VS Code et Copilot 0.6.5. Les filtres et tris par colonne ne l’effacent pas.
- Poignée avec rang, repère avant/après, déplacement au clavier avec ↑ / ↓ et
  bouton Mon classement pour retrouver cet ordre après un tri.
- Réordonnancement transactionnel protégé contre les déplacements simultanés,
  sans modifier priorité, échéance, avancement, sources ou rattachements.
- Outil agent de classement explicite avec révision globale, conservé dans la
  mémoire et l’export privé. Les nouvelles lignes sont ajoutées en fin de liste
  après un premier classement manuel.
- Les outils Priorités MCP respectent le contexte strict de l’agent ; les vues
  manuelles conservent leur périmètre portfolio explicite.

## 0.1.130

- Priorités communes à VS Code et Copilot 0.6.4 : produit principal et plusieurs
  produits ou équipes partenaires, avec un filtre portant sur toutes les
  participations et des filtres distincts pour le principal et les partenaires.
- URL source séparée du lien de documentation, conservée à l’édition et
  exploitable par l’agent pour retrouver le Google Sheet d’origine.
- État En cours reconnu dans Priorités, Tasks, Today et les fiches d’entités.
- Nature Sujet / Tâche modifiable, filtre permettant de séparer les listes,
  bouton Modifier visible et compteurs respectant les filtres de champ.
- Tous les nouveaux champs peuvent être créés et modifiés par les deux agents,
  avec conservation des champs omis et des liens préexistants.

## 0.1.129

- Fiches des entités corrigées dans le graphe commun à VS Code et Copilot 0.6.3 :
  la consultation manuelle fonctionne aussi hors du contexte strict de l’agent,
  sans modifier ce contexte ni ses droits de lecture.
- Diagnostic et bouton Retry dans la fiche et l’espace de travail en cas
  d’échec, de réponse invalide ou d’absence de réponse, avec protection contre
  les réponses obsolètes après une nouvelle tentative.

## 0.1.128

- Écran Priorités intégré au thème du cockpit commun à VS Code et Copilot 0.6.0,
  avec sujet, description, produit concerné, attendu par, priorité, deadline et URL.
- Rattachement obligatoire à une entité existante lors de la création ou de
  l’édition ; les anciennes tâches sans rattachement restent visibles à corriger.
- Tri ascendant/descendant par colonne et filtres combinables par champ, appliqués
  avant la pagination ; conservation des estimations et des dates à préciser.
- Création et modification de tous les champs par les agents des deux hôtes,
  avec détection des conflits sur la tâche et ses liens ; actualisation des autres
  vues après un enregistrement dans le cockpit.

## 0.1.127

- Partage d’une même mémoire locale avec Copilot 0.5.1 : récupération automatique
  des verrous dont le processus propriétaire est confirmé arrêté, attente des
  opérations actives et diagnostic du propriétaire en cas de blocage.
- Arrêt du daemon par fermeture de son entrée : les opérations en cours se
  terminent et libèrent la mémoire avant la fermeture. Une réponse perdue ou un
  délai dépassé ne déclenche plus une deuxième écriture automatique.

## 0.1.126

- Cockpit partagé avec le plugin Copilot 0.5.0 : graphe 2D/3D, notes, Inbox,
  sources, Today, contextes, aide et réglages utilisent le même renderer et
  le même contrôleur métier dans les deux hôtes.
- Ajout de l’écran Priorités dans le cockpit VS Code, avec le même tableau,
  les mêmes formulaires et la même protection contre les éditions obsolètes.
- Adaptateurs Copilot pour dialogues, aperçus de fichiers, onboarding après
  installation et curation avec les règles de validation communes.

## 0.1.124

- Show newly saved notes in the Notes list as soon as local storage confirms the write, while search indexing and cockpit refresh continue.
- Keep the saved note visible across older background snapshots and prevent repeated Save clicks from creating duplicates.

## 0.1.123

- Show progress immediately when checking for updates and stop network requests that do not respond.
- Report a manually requested result even when an automatic update check is already running, and log failures in OneAgent Output.

## 0.1.122

- Keep the Notes editor and its keyboard focus intact when background note details or cockpit state refreshes arrive.

## 0.1.121

- Add an Open Markdown action to the selected entity in the graph, opening its primary page directly in the VS Code editor when the file is accessible.

## 0.1.120

- Give the agent a dedicated action to save notes and open questions directly in the Notes page.
- Add `@memory /note` for quick capture and route generic note captures through the same path, without starting curation or building a context pack.
- Refresh and index saved notes so they appear promptly in OneAgent.

## 0.1.119

- Store entity knowledge in Markdown pages while keeping links, tasks, provenance, and full-text indexes in SQLite.
- Replace local embedding and vector search with SQLite full-text search; no local embedding server is required.
- Migrate existing workspaces automatically after the VSIX update and reload, with a backup and a one-time migration marker.
- Let the agent create and update entity pages through explicit Organization actions.

## 0.1.118

- Make entity groups in the Notes picker expandable and scrollable while searching, so a different linked entity can be selected.

## 0.1.117

- Document every supported `@memory /ingest` shortcut for pasted text, file attachments, editor selections, and complete open documents.
- Add `@memory /oneagent-help` so users can ask questions grounded in the English guides bundled with OneAgent, independently of the workspace runtime.
- Link each chat help answer to its most relevant built-in guide and keep model context bounded with a useful fallback when Copilot is unavailable.

## 0.1.116

- Add a dedicated Notes workspace to create, edit, filter, resolve, archive, and restore entity-linked notes and open questions.
- Index manual notes locally for search and agent context, while keeping saved content safe when the embedding service is temporarily unavailable.
- Add searchable, built-in English guides for ingestion, entities, Graph views, agent context, Context Packs, daily work, review, updates, and the complete oMLX/BGE-M3 setup.
- Distinguish a first installation, the first use of each workspace, and an extension update so OneAgent shows the right welcome or What's new experience.
- Make capture revisions atomic and let deferred embedding backfill discover chunks created while indexing is already running.

## 0.1.115

- Publish a validation release for the corrected in-app VSIX update flow and the new Settings update button.

## 0.1.114

- Install downloaded updates from an explicit local or remote VSIX file URI accepted by VS Code, instead of the extension's unsupported internal storage URI.
- Distinguish update lookup failures from VSIX installation failures and explain the `No Servers` compatibility error clearly.
- Add a Check for updates button to the OneAgent cockpit Settings screen.

## 0.1.113

- Validate the complete public GitHub release and in-app VSIX automatic update path introduced in 0.1.112.

## 0.1.112

- Check the public `OneAgent-release` repository daily and install newer stable VSIX releases automatically from inside VS Code.
- Verify every downloaded VSIX against its published SHA-256 checksum before installation and keep a manual update command plus an opt-out setting.
- Publish versioned VSIX and checksum assets to the dedicated public release repository while keeping the development repository private.

## 0.1.111

- Replace product-scoped agent Inbox reads with typed `kind:id` entity filters and apply the same generic boundary to curation-package discovery.
- Retire the ambiguous Wiki `list` action, compact entity/package responses, and return the exact proposal id and next action from Wiki writes.
- Make Inbox accept/reject responses valid JSON on first execution and idempotent retries so a successful publication is never reported as a parsing failure.
- Automatically resolve compatible single- and multi-source Wiki evidence without requiring agents to inspect conversation files, SQLite or shell output.

## 0.1.110

- Unify capture ingestion, observations and Wiki synthesis on typed graph entity references; agent tools no longer accept or infer `productId` for these workflows.
- Resolve repository Wiki scans and projections from generic repository entities and graph relations, including products created only in the Knowledge Graph.
- Migrate source associations to `source_entities`, backfill observation subjects and keep entity-scoped search, cards and Context retrieval consistent.
- Run the daily dependency and GitHub repository refresh from generic entities and `depends_on` relations, then reindex updated repository entities.

## 0.1.109

- Treat products and repositories as ordinary graph entity kinds rather than requiring dedicated creation actions.
- Route every agent-requested entity creation through a pending Inbox graph-change proposal; direct Organization upserts update existing entities only.
- Show related database-backed product entities in Cockpit filters while keeping external product subgraphs outside the selected portfolio boundary.

## 0.1.108

- Check configured product dependencies and linked GitHub repositories once every 24 hours or at the next VS Code startup.
- Fast-forward only clean repositories, preserve dirty or divergent worktrees, and reindex products whose repositories changed.
- Add a manual repository sync command and an opt-out setting for daily synchronization.

## 0.1.107

- Resolve Node from the configured path, the extension environment, or VS Code's embedded runtime so packaged installs work when GUI applications do not inherit a shell PATH.
- Report daemon startup only after the process has actually spawned, avoiding misleading `pid undefined` messages.

## 0.1.106

- Allow individual or batch observation rejection without entering a reason, while keeping optional audit notes and requiring rationale for corrective operations.

## 0.1.105

- Replace per-tool confirmation dialogs during bounded autonomous curation with one consolidated completion notification, while preserving confirmations for ordinary interactive tool calls.

## 0.1.104

- Raise the default Context Pack budget from 12,000 to 64,000 tokens and expose it as a VS Code setting.
- Remove the hidden 5,000-token participant cap and size Context delivery against the selected model.
- Explain the active context specifically during ingestion, and require an explicit target in strict mode.
- Diagnose curation failures per turn and tool call, persist the reason on the capture card, and open the OneAgent output directly from the error notification.
- Keep bounded internal curation tool calls free of automatic Context Pack injection.

## 0.1.103

- Detect legacy research pages stored under `products/<product>/discovery/` during Wiki migration and lint.
- Move pages automatically only when controlled metadata binds them to an existing product-scoped Discovery.
- Keep unbound interviews and research notes in review with explicit guidance to re-ingest them as captures instead of inventing graph entities.

## 0.1.102

- Resolve hyphenated entity identifiers safely in SQLite FTS and Context suggestions.
- Enforce canonical entity-owned Wiki paths and reject path-only writes and proposals.
- Detect and migrate flat legacy `discovery/<id>.md` pages into product-scoped `discoveries/<id>/index.md` slices.
- Prevent canonical and legacy Wiki copies from being merged silently in Discovery context.
- Make agents fail closed when structured mutations fail instead of editing SQLite or Markdown directly.

## 0.1.101

- Clarify that Inbox observations add sourced information to existing entities, with quantitative results presented as evidence rather than entities.
- Fix saved Graph views remaining dirty after a successful update and show explicit update progress and confirmation.
- Automatically select accepted target-compatible evidence for Wiki decisions and writes, with precise subject diagnostics when evidence is incompatible.
- Block legacy placeholder Wiki proposals that cannot publish a durable page.

## 0.1.100

- Add Discovery as a core, product-scoped entity with a validated research lifecycle and outcomes.
- Keep user interviews as source captures while aggregating interviews, evidence, insights and feature requests around their Discovery.
- Open a dedicated Discovery view in the Graph side panel with its synthesis, sources, observations, decisions, risks and next steps.
- Teach curation, Copilot tools and wiki layout rules how to create, relate and document Discoveries consistently.

## 0.1.99

- Add Mission → OKR → KPI outcome steering while keeping key results inside their OKR.
- Turn Today into an outcome dashboard with KPI trends, sparklines, alerts and expected work contributions.
- Add immutable KPI measurements, before/after comparisons, archival and provenance-aware export/import.
- Expose outcome operations consistently through the Cockpit, CLI and Copilot Outcomes tool.
- Add contextual search planes and enriched entity spaces under the active Context boundary.

## 0.1.98

- Turn capture interpretations into exact, revision-aware sourced observations.
- Review observations by source package with partial accept, correction, merge, rejection and audit history.
- Surface accepted knowledge, weak signals, corroborations, contradictions and stale evidence in entities and Context Packs.
- Keep wiki pages optional and require accepted observations plus an explicit durable-documentation reason.
- Expose the same review workflow in the Cockpit, CLI and Copilot tools under the active strict context boundary.

## 0.1.97

- Send the complete versioned Context Pack to the agent with a stable session identity.
- Include relevant tasks and Inbox weak signals in Context Packs under the same scope and token budget.
- Refresh monitored Context Views when memory changes while keeping suggestions reviewable.
- Show each Context suggestion's reason, confidence and estimated token cost in the Graph panel.

## 0.1.96

- Preserve the local Context draft when an automatic cockpit refresh arrives before activation.

## 0.1.95

- Open a floating Context control panel directly over the Graph when switching from Navigate to Context.
- Activate or update the current Context View without leaving the Graph.
- Prepare, inspect and revisit versioned Context Packs with token budget, entries and provenance.

## 0.1.94

- Fix extension activation after the Context control plane release.
- Add a module-load smoke check so startup-time reference errors fail packaging.

## 0.1.93

- Add persistent, versioned context views with explicit inclusion, proposal and exclusion roles.
- Compile context packs for agent interactions with source, relation, time, validation and token-budget policies.
- Expose the context control plane consistently through the cockpit, CLI and Copilot tools.

## 0.1.91

- Add `@memory /migrate-wiki` to preview the canonical wiki migration.
- Add `@memory /migrate-wiki apply` with explicit confirmation, automatic backup and post-migration lint.

## 0.1.83

- Keep the Graph side panel focused on inspecting and editing the selected entity or explicit relation.
- Remove the Graph side panel from Today, Captures/Sources and other unrelated views.
- Move Agent Context and runtime diagnostics to Settings, and explain planning readiness in Today.

## 0.1.82

- Raise the cockpit graph capacity to 500 visible nodes and 1,200 visible edges.
- Preload larger graph slices for search and filtering, with explicit truncation diagnostics.
- Increase graph repulsion to improve readability in dense views.

## 0.1.81

- Prepare OneAgent for Visual Studio Marketplace distribution.
- Use the Marketplace as the update channel.
