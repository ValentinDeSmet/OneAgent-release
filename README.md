# OneAgent

Deux plugins en parallèle :

- [GitHub Copilot 0.6.8](docs/copilot.md) : ajouter ce dépôt comme catalogue, puis installer ou mettre à jour OneAgent. Le paquet inclut le **cockpit complet partagé avec VS Code** : graphe 2D/3D, notes, tâches, priorités, Inbox, sources, Today, contexte, aide et réglages.
- Extension VS Code : guide ci-dessous et fichiers VSIX dans les releases.

Version 0.6.8 : filtres de priorités à cases à cocher avec sélection multiple, recherche et compteurs basés sur les sollicitations avant pagination. Suppression explicite et transactionnelle des sollicitations, sans les marquer terminées ni supprimer l’entité ou les notes privées. Les fichiers Markdown ouverts depuis le cockpit apparaissent dans un onglet document OneAgent au sein de Copilot, avec lecture formatée et édition du fichier original. Un autre clic sur le même fichier ramène au même onglet. Le lecteur fonctionne sans CDN et refuse les enregistrements si le fichier a changé depuis sa lecture, en conservant le brouillon. Cet onglet utilise le Canvas du plugin ; il ne remplace pas l’éditeur de fichiers natif interne de Copilot. Priorités : classement manuel par glisser-déposer et clavier, affiché par défaut et partagé entre les hôtes. Bouton Mon classement pour revenir après un tri. Produit principal et partenaires, filtres par produit ou équipe, liens de documentation et de source distincts, avancement « En cours », choix entre sujets et tâches.

Après mise à jour, ouvrir une nouvelle session Copilot et demander **« Ouvre le cockpit OneAgent »**. [Guide du cockpit](docs/copilot.md) · [Code partagé de l’interface](plugins/oneagent/cockpit/src/cockpit.js) · [Adaptateur Copilot](plugins/oneagent/com.github.copilot/extensions/oneagent-cockpit).

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
