# Distribution Copilot et VS Code

Le dépôt public `ValentinDeSmet/OneAgent-release` distribue le VSIX pour VS Code,
le plugin Agent Plugins 1.0 et son catalogue pour Copilot, et un ZIP de secours.
La mémoire privée et les réglages des postes restent hors de ces paquets.

## Publication

Le workflow `.github/workflows/release.yml` est déclenché par un tag stable `vX.Y.Z`
correspondant à la version de l’extension VS Code. Il conserve le secret existant
`ONEAGENT_RELEASE_TOKEN`, limité à Contents read/write sur le dépôt de releases.
Les publications sont sérialisées ; aucun nouveau service ni secret n’est requis.

Avant une release :

1. Incrémenter la version VS Code pour obtenir un nouveau tag de release.
2. Si le plugin Copilot ou son moteur embarqué a changé, incrémenter ensemble
   `apps/copilot-plugin/plugin.json` et `packages/mcp-server/package.json`.
   Les deux adaptateurs conservent leur propre numéro de version.
3. Exécuter `pnpm typecheck`, `pnpm copilot:check`, `pnpm extension:check`, puis
   `pnpm copilot:package`. Examiner `pnpm copilot:publication-plan` : cet aperçu
   local ne fait aucun appel réseau et utilise un SHA de remplacement explicite.
4. Committer les modifications retenues, puis pousser le nouveau tag stable.

Le pipeline prépare les entrées explicites du build Copilot, publie un commit
avec le code installable, puis un catalogue dont la source pointe sur ce commit
immuable. Le changement de branche est atomique et non forcé ; une modification
concurrente du dépôt de releases interrompt la publication.

Le catalogue garde le nom `oneagent`, pour installer `oneagent@oneagent`.
Une version inférieure est refusée ; une version identique ne peut être republiée
avec un fichier différent. Cette vérification couvre tous les fichiers du plugin,
y compris le runtime partagé avec VS Code.

La release GitHub cible le commit de publication et contient le VSIX, le ZIP Copilot
et leurs SHA-256. Pour vérifier le ZIP après téléchargement :

```sh
shasum -a 256 -c oneagent-copilot-0.6.10.zip.sha256
```

Le dépôt de releases reçoit **le code du runtime installable** et les guides,
nécessaires au chargement natif de Copilot. Il ne reçoit pas le dépôt de développement
complet, les tests, les dépendances de développement, les configurations locales
ou les données de mémoire. Ne pas ajouter de données privées aux sources du runtime.

Le catalogue devient accessible avant la création de la release GitHub. Si cette
dernière étape échoue, Copilot peut déjà voir le plugin publié. Vérifier le catalogue
et les assets avant de relancer le job : ne pas réutiliser une version de plugin
avec du code modifié. La recréation d’une release existante est refusée ; réparer
explicitement ses assets si la première publication est restée partielle.

## Installation et mises à jour

L’utilisateur ajoute une fois l’URL du dépôt dans **Customize → Plugins**, puis
installe OneAgent. Le choix de mémoire et le choix automatique/manuel se font
après installation. Un ancien ZIP installé localement doit être remplacé une fois
par l’installation officielle pour suivre les versions distantes. Le guide livré
décrit ce changement de source sans supprimer la mémoire.

Le serveur MCP vérifie le catalogue GitHub officiel avec une requête bornée, un
délai maximal et sans token utilisateur. Une version stable et une source OneAgent
épinglée sur un SHA sont exigées. Copilot effectue l’installation du plugin complet.

Le choix automatique modifie uniquement l’entrée OneAgent des paramètres utilisateur
JSONC de Copilot. Les commentaires et autres entrées sont préservés. Un catalogue
homonyme pointant ailleurs, un fichier invalide ou un conflit de modification
provoquent une erreur sans remplacement. Les politiques d’entreprise restent
appliquées par l’hôte.

Depuis 0.6.15, le bouton **Mettre à jour OneAgent** utilise `session.rpc.plugins`
pour lister, actualiser uniquement le catalogue OneAgent et installer le plugin,
avec le compte et les règles de l’application. Il n’exige pas de CLI ni un accès
GitHub séparé depuis Node.js. Le rechargement MCP/extensions conserve le chat et
le nouveau processus réouvre automatiquement les Canvas OneAgent de cette session.
Un brouillon ou une opération en cours diffère l’installation ; une tentative de
rechargement échouée se reprend avec un bouton, sans rejouer l’installation.

Le chemin MCP `oneagent_update_plugin` conserve les commandes CLI comme compatibilité.
Après installation ou échec incertain, l’ancien moteur est bloqué jusqu’au
rechargement dans ce chat, pas jusqu’à la création d’une nouvelle conversation.
Voir le [guide de mise à jour et de transition](../apps/copilot-plugin/README.md#recharger-sans-recommencer-le-chat).

## Validation de l’hôte encore nécessaire

Les tests locaux couvrent le serveur MCP, les paramètres JSONC, les conflits,
la séquence de commandes natives, les échecs partiels, le build autonome et la
publication via une API GitHub simulée. Ils n’installent aucun plugin personnel
et n’accèdent pas à la mémoire de travail.

Après la première publication, valider sur le Mac cible :

1. Installation par URL, découverte du skill et des outils, onboarding sans JSON.
2. Publication d’une version suivante ; mise à jour depuis la conversation,
   sans fermeture manuelle des Canvas ni message de relance ; même conversation, nouvelle version et notes conservées.
3. Option automatique dans une session CLI prise en charge.
4. Comportement effectif de l’application macOS et politiques du poste professionnel.

GitHub documente l’auto-update des catalogues personnalisés pour les sessions CLI
interactives et `-p`, en excluant SDK/serveur. L’option ne garantit donc pas son
déclenchement dans l’application macOS. Le parcours conversationnel manuel et les
commandes natives restent disponibles en attendant cet essai.

Sources vérifiées le 1er octobre 2026 :

- [Plugins Copilot](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [Paramètres utilisateur Copilot](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- [Personnalisation de l’application](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)


À partir de Copilot 0.4.0, préparation et publication refusent un paquet sans
le canvas Priorités complet (`extension.mjs`, serveur, HTML, JavaScript, CSS)
sous `com.github.copilot/extensions/oneagent-priorities/`, ou sans ses outils.
Le catalogue doit épingler le commit contenant le front et le moteur ensemble.


## Cockpit partagé (0.5.0)

Le paquet contient `cockpit/src/`, les guides, le manifeste VS Code (schémas des
outils de curation) et `cockpit/media/graph-viewer.bundle.js`. Ils sont construits
à partir des sources VS Code lors de chaque préparation, sans copie indépendante
des écrans. Le contrôleur est instancié avec les services de l’hôte ; l’activation
VS Code et ses watchers ne sont pas exécutés dans Copilot.

`com.github.copilot/extensions/oneagent-cockpit/` fournit le canvas, le serveur
local authentifié, le pont de messages et les dialogues. Les appels CLI libèrent
le verrou après chaque opération. Les confirmations ne sont pas des outils agent.
La publication refuse un paquet qui omet le cockpit, ses adaptateurs, les guides,
les priorités communes ou le bundle du graphe. `copilot:check` prépare ce paquet
puis teste le contrôleur et le serveur distribués avec des mémoires temporaires.

## Partage de la mémoire locale (0.5.1)

Mettre à jour VS Code vers 0.1.127 et Copilot vers 0.5.1, puis relancer les hôtes.
Les deux peuvent viser le même fichier de configuration. Les opérations sont
sérialisées ; le verrou est libéré entre deux commandes. Un propriétaire local
confirmé arrêté permet une récupération automatique, même pour un verrou valide
écrit par la version précédente. Un verrou actif ou non vérifiable reste protégé.

La fermeture du daemon VS Code laisse finir les requêtes déjà reçues. Un délai
dépassé ou une réponse perdue ne provoque plus une répétition automatique de
l’écriture. Les tests couvrent un daemon persistant, des workers Copilot concurrents,
un arrêt forcé pendant une transaction et l’intégrité SQLite après récupération.

## Priorités intégrées (0.6.0)

La publication embarque l’écran commun et les nouveaux schémas agent avec
rattachement obligatoire, produit concerné, description et URL. Les tris et
filtres sont appliqués par le moteur commun avant la pagination. Les tests
comparent les schémas MCP / VS Code et exercent création, modification, conflits,
liens, filtres, tri et le contrôleur de la page intégrée sans navigateur.

## Mise à jour et accès réseau (0.6.1)

L’installation ne dépend plus du `fetch` de vérification vers `api.github.com`.
Le plugin valide sa source officielle et l’installation courante, puis délègue
l’actualisation du catalogue et la mise à jour à Copilot. Il vérifie la version
installée et conserve le blocage de l’ancienne session après un changement ou
un résultat d’installation incertain. Une installation confirmée inchangée ou
un échec avant installation ne demande pas de nouvelle session.

La vérification de version garde un diagnostic réseau explicite (DNS, TLS, délai,
HTTP) sans exposer les détails bruts du proxy. Le cockpit propose le parcours
Copilot direct uniquement pour un catalogue indisponible, pas pour un catalogue
malformé ou une source inattendue. Une ancienne version se débloque avec les
commandes officielles de mise à jour du CLI sur le poste concerné ; une nouvelle
version ne peut pas corriger son prédécesseur avant cette première installation.

## Démarrage du moteur dans les canvases (0.6.2)

Le pont mémoire n’exécute plus aveuglément `process.execPath`. Il conserve un hôte
Node standard, ou recherche Node dans les entrées absolues du PATH de l’hôte,
avec une surcharge explicite `ONEAGENT_NODE_PATH`. Une sonde sans accès à la mémoire
vérifie la version, TypeScript et SQLite en mémoire vive. Les options de sécurité
et autres variables de l’environnement sont conservées.

Le processus worker doit annoncer `ready` avant de recevoir une opération. Un délai
de démarrage ne peut arrêter qu’un worker auquel aucune requête n’a été envoyée.
Après envoi, aucune répétition ni interruption automatique n’est ajoutée. Les
diagnostics classent les erreurs connues sans afficher stderr ou l’environnement.
Les tests couvrent un hôte non Node, un paquet incomplet, un Node incompatible,
un accès refusé avant démarrage et une écriture interrompue sans nouvelle tentative.

## Fiches d’entités dans le cockpit (0.6.3)

La consultation manuelle des fiches suit la portée du graphe (`portfolio`),
indépendamment du contexte strict réservé aux outils agent. Elle ne change pas
la portée active. Les échecs de lecture sont renvoyés à la fiche et à l’espace
de travail ; un bouton Retry permet une nouvelle tentative explicite.

## Priorités transverses (0.6.4)

Le cockpit et le canvas Priorités réutilisent les mêmes contrôles et le même
contrat agent : partenaires produit/équipe, URL source, état En cours et nature
Sujet/Tâche. Le formulaire conserve les valeurs des champs nouveaux lors des
éditions. Les données restent dans `tracking_json` et dans les liens natifs des
tâches : aucun nouveau stockage ni migration SQL nécessaire.

## Classement des priorités (0.6.5)

Le contrôleur commun propose glisser-déposer et clavier, affiche le classement
manuel par défaut et permet un retour après les tris par colonne. L’outil
`oneagent_reorder_priority` et son équivalent VS Code utilisent une révision de
l’ordre portfolio et une transaction. Les rangs persistent dans `tracking_json`,
indépendamment des filtres et pages, et sont conservés dans l’export privé.
