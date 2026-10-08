# OneAgent

Deux plugins en parallèle :

- [GitHub Copilot 0.6.16](docs/copilot.md) : installation et mise à jour depuis ce catalogue.
- Extension VS Code : guide ci-dessous et fichiers VSIX dans les releases.

Le cockpit complet est partagé : graphe, notes, tâches, priorités, Inbox, sources, Today, contexte, aide et réglages.

**Mémoire : graphe et liste (Copilot 0.6.16 / VS Code 0.1.139).** Recherche textuelle, filtres multiples par type et entité liée, tri, regroupement et vues enregistrées avec leur affichage. Le catalogue couvre les entités, pages Markdown, sources liées, notes et tâches, indépendamment du nombre de nœuds chargés dans le graphe. Ouverture directe du fichier ou de sa source. La barre de navigation se compacte et les fiches s’ouvrent en panneau superposé sur fenêtre étroite. [Guide des vues](docs/memory-views.md).

Les mises à jour Copilot conservent le parcours du bouton introduit en 0.6.15 : installation native, rechargement des outils dans la même conversation, réouverture des onglets. [Guide et compatibilité](docs/copilot.md#recharger-sans-recommencer-le-chat).

**Vues de priorités enregistrées.** Onglets, filtres multiples et tri enregistrés, ajustements temporaires et mise à jour explicite, duplication et choix par défaut. Les listes restent dynamiques ; Mon classement conserve le rang global. [Guide des priorités](docs/priorities.md).

L’Inbox Markdown permet de proposer un document, modifier l’aperçu puis accepter sa publication privée, sans embeddings.

---

# OneAgent — installation

OneAgent est une extension VS Code qui conserve la connaissance de travail sur votre Mac. Les entités ont chacune une page Markdown dans `wiki/`. SQLite garde les liens entre entités, les tâches, les observations sourcées et un index de recherche plein texte. Aucun serveur de modèle local n’est nécessaire pour capturer, classer ou rechercher ces informations.

## Installer le VSIX

1. Téléchargez le fichier `.vsix` depuis la [dernière version publique](https://github.com/ValentinDeSmet/OneAgent-release/releases/latest).
2. Dans VS Code, ouvrez **Extensions → … → Install from VSIX…**.
3. Sélectionnez le fichier téléchargé, puis rechargez VS Code si nécessaire.

Le dépôt public contient les versions installables. Le code source et les données de travail restent dans le dépôt privé et votre espace local.

## Première ouverture

Ouvrez **OneAgent: Open Cockpit** depuis la palette de commandes. OneAgent crée `.work-memory/config.yaml` dans l’espace de travail au besoin. Ajoutez vos entités, captures et tâches depuis le Cockpit ou les outils de l’agent. Les pages d’entités sont enregistrées dans `wiki/` et leur contenu est recherché localement avec SQLite FTS5.

L’agent peut créer ou modifier une entité à votre demande explicite. Les conclusions qu’il déduit seul à partir de captures continuent de passer par l’Inbox et la validation des observations. Les liens, tâches, mesures et citations restent dans SQLite.

## Mettre à jour une installation existante

Au premier démarrage de cette version, OneAgent sauvegarde la base SQLite, le wiki et les captures sous `.work-memory/backups/knowledge-…/`, puis crée les pages Markdown manquantes. Les anciens textes dont le fichier d’origine a disparu sont récupérés depuis les chunks SQLite sous `wiki/imported-sources/`. La récupération conserve les mots, les identifiants de source et les citations ; la mise en forme d’origine peut différer.

Pour examiner la migration depuis le dépôt source :

```bash
pnpm wm migrate-knowledge
```

Pour la relancer explicitement :

```bash
pnpm wm migrate-knowledge --apply
```

La recherche est maintenant plein texte. Elle ne trouve plus les paraphrases uniquement grâce à la similarité vectorielle ; utilisez aussi les noms d’entités, leurs liens et les observations validées pour explorer le contexte.

## Diagnostic

Dans le Cockpit, ouvrez **Settings → Diagnose**. Pour signaler un problème, ouvrez **View → Output → OneAgent** et partagez le message d’erreur sans inclure vos données sensibles.

## Confidentialité

Les pages, captures et index SQLite restent sur votre Mac. La recherche plein texte n’envoie aucun contenu à un service externe. Les fonctions optionnelles de Graphify ou d’un fournisseur de modèle externe suivent leur propre configuration.

## Licence

OneAgent est un logiciel propriétaire. Son utilisation, sa redistribution et sa modification nécessitent l’autorisation du titulaire des droits.
