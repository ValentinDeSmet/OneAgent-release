# OneAgent pour l’application GitHub Copilot

Version 0.6.10 : Inbox avec documents Markdown proposés par l’agent, aperçu formaté, édition et acceptation humaine sans embeddings ; cockpit complet partagé avec VS Code, installation par catalogue GitHub, choix des mises à jour et
configuration de la mémoire **après installation, dans la conversation Copilot**.
L’extension VS Code reste disponible en parallèle. Les deux adaptateurs
réutilisent le même moteur et peuvent viser la même mémoire sur un même Mac.

Les priorités proposent des filtres multiples à cases à cocher, limités aux
valeurs présentes dans les sollicitations. Les actions de ligne utilisent un crayon
et un menu ⋯. « Retirer des priorités » conserve la tâche native, son avancement
et ses liens dans Tâches. La vue « Retirées des priorités » permet de remettre
la même tâche dans la liste, sans la recréer.

BMAD Readiness a été supprimé du cockpit et du moteur. Today, les priorités,
les tâches et les autres intégrations BMAD restent disponibles.

## Installer sur le Mac cible

Prérequis : Node.js >=22.18 visible depuis Copilot, Copilot CLI et l’application
GitHub Copilot. Le paquet inclut le moteur ; aucun clone du dépôt OneAgent, pnpm
ou VS Code n’est nécessaire sur le poste cible.

### Installation par URL (recommandée)

Ce parcours devient disponible après la première publication du catalogue 0.5.0
dans le dépôt de releases. Le build local ne publie rien sur GitHub.

Dans l’application, ouvrir **Customize → Plugins**, ajouter le catalogue :

```text
https://github.com/ValentinDeSmet/OneAgent-release
```

Installer **OneAgent** depuis ce catalogue. Aucun ZIP à importer, aucun paramètre
de mémoire à préparer. Le nom du catalogue est `oneagent`.

L’équivalent via Copilot CLI :

```sh
copilot plugin marketplace add ValentinDeSmet/OneAgent-release
copilot plugin install oneagent@oneagent
copilot plugin list --json
```

### ZIP de secours

Décompresser `oneagent-copilot-0.6.10.zip` dans un dossier durable. Le paquet inclut
un guide `INSTALLATION.md` et le dossier `plugins/oneagent` contenant `plugin.json`.
Pour une installation locale (par exemple avant publication du catalogue) :

```sh
copilot plugin install "/chemin/oneagent-copilot-0.6.10/plugins/oneagent"
copilot plugin list --json
```

Une installation depuis un dossier local ne suit pas automatiquement le catalogue
GitHub. Pour obtenir les futures mises à jour sans réimporter de ZIP, passer une
fois au catalogue officiel avec le parcours ci-dessous.

Après toute installation, ouvrir une nouvelle session **locale** dans l’application et vérifier les
composants OneAgent dans **Customize**. La documentation GitHub indique que les
serveurs MCP et skills configurés via Copilot CLI sont aussi disponibles dans
l’application. Ce parcours réel dans l’hôte reste à valider.

## Premier démarrage : « Configurer OneAgent »

Aucun fichier de paramètres à préparer. Après installation, dire à Copilot :

> Configurer OneAgent.

Le skill `oneagent-memory` guide deux choix :

1. **Créer une mémoire sur ce Mac** : le dossier proposé est `~/OneAgentMemory`.
   L’utilisateur peut choisir un autre dossier neuf. Le plugin crée la mémoire
   avec le moteur commun et enregistre la liaison.
2. **Connecter une mémoire existante** : indiquer son dossier ou son fichier de
   configuration. Si VS Code utilise déjà OneAgent sur ce Mac, sélectionner cette
   même mémoire. La connexion vérifie le fichier et l’existence de la base ; elle
   ne modifie pas les données. Les migrations habituelles du moteur pourront
   s’appliquer à la première utilisation : conserver une sauvegarde d’une ancienne
   mémoire avant de l’utiliser.

Copilot présente l’emplacement choisi. Une fois ce choix fait par l’utilisateur,
les outils deviennent utilisables **dans la même conversation**, sans redémarrage.
Le choix est conservé aux sessions suivantes. Une première demande de recherche
ou de note peut aussi déclencher ce parcours si aucune mémoire n’est connectée.

À la fin, choisir **mises à jour automatiques** ou **mises à jour manuelles**.
Cette étape est facultative et ne bloque pas l’accès à la mémoire. Le plugin
enregistre uniquement la préférence du catalogue OneAgent dans les paramètres
utilisateur Copilot ; les réglages BMAD et les autres plugins sont conservés.

Il s’agit d’un onboarding conversationnel via le skill et les outils MCP ; le
plugin n’impose pas une fenêtre native à l’installation. Aucun dossier mémoire
n’est créé au simple démarrage et aucune note de démonstration n’est ajoutée.

Pour essayer ensuite :

> Crée une note privée OneAgent intitulée Test installation, avec le contenu
> Première utilisation sur ce Mac, puis relis-la.

## Ouvrir les fichiers Markdown

Depuis le cockpit, les boutons d’ouverture d’un fichier `.md` ouvrent un onglet
document dans Copilot, intitulé comme le fichier. Un second clic retrouve le
même onglet. Le mode **Lecture** affiche le Markdown formaté (titres, listes,
tableaux et blocs de code). **Modifier** et **Enregistrer** travaillent sur le
fichier original ; ouvrir le document ne le modifie pas.

Un changement concurrent refuse l’enregistrement et conserve le brouillon.
Les liens vers d’autres fichiers Markdown autorisés ouvrent un autre onglet.
Le rendu est embarqué dans le plugin et fonctionne sans téléchargement depuis
un CDN. Les fichiers internes du plugin restent en lecture seule.

Cet onglet est un Canvas document fourni par OneAgent, ouvert dans Copilot.
L’API publique utilisée ne donne pas accès à l’éditeur interne de fichiers de
l’application. Il faut une session locale prenant en charge les Canvas.

## Mettre à jour sans télécharger de fichier

Dans la conversation :

> Vérifie les mises à jour OneAgent.

> Mets à jour OneAgent.

Le premier appel compare la version du plugin au catalogue GitHub stable, sans
ouvrir la mémoire. Le second utilise directement Copilot CLI, sans exiger un
accès préalable de Node.js à l’API GitHub, pour actualiser le catalogue
`oneagent`, puis mettre à jour uniquement ce plugin. Une nouvelle session charge
ensuite le moteur, le manifeste et le skill ensemble. La mémoire et sa liaison
locale ne sont ni transférées ni reconfigurées.

La première mise à jour demande d’avoir choisi le mode automatique ou manuel,
afin de fixer la source officielle. Une erreur réseau de vérification laisse le
plugin utilisable et ne demande pas de nouvelle session. Le message distingue
DNS, certificat TLS, délai ou réponse HTTP lorsque le système fournit ce détail.
Le cockpit propose alors une mise à jour via Copilot, sur choix explicite. Après une tentative d’installation dont le résultat est incertain,
ouvrir une nouvelle session et consulter le gestionnaire de plugins avant de
réessayer ; le serveur évite de mélanger deux versions du moteur.

Équivalent dans un terminal, sans télécharger de ZIP :

```sh
copilot plugin marketplace update oneagent
copilot plugin update oneagent
```

### Si une ancienne version affiche « fetch failed »

Le catalogue peut être accessible à Copilot alors que l’accès direct de Node.js
à `api.github.com` échoue sur le poste. Avant 0.6.1, ce contrôle bloquait aussi
l’installation. Un nouveau chat ne répare pas ce problème réseau.

Si `copilot --version` fonctionne dans le Terminal de ce poste, exécuter les
commandes ci-dessus, puis `copilot plugin list --json` pour vérifier la version.
Après une mise à jour effective, ouvrir une nouvelle session pour charger le
plugin. Si la liste du CLI ne contient pas l’installation utilisée par l’application,
consulter son gestionnaire de plugins avant de créer une deuxième installation.

Si l’actualisation du catalogue échoue également, relever son erreur exacte :
le réseau/proxy ou les certificats du poste restent à diagnostiquer. Ne pas
modifier les réglages BMAD, la liaison mémoire ou la validation TLS pour résoudre
ce message. Une installation ZIP ancienne suit le parcours de migration ci-dessous.

L’option automatique repose sur `extraKnownMarketplaces.oneagent.autoUpdate`
dans `~/.copilot/settings.json` (ou le dossier désigné par `COPILOT_HOME`). GitHub
la documente au démarrage des sessions CLI interactives et `-p`, pas des sessions
SDK/serveur. **Le déclenchement automatique dans l’application macOS reste à
valider.** En attendant, la commande conversationnelle fournit le parcours manuel
sans import. La préférence enregistrée n’atteste pas que l’application l’a appliquée.
Les politiques d’entreprise et une désactivation globale priment ; OneAgent ne
modifie pas ces restrictions. Aucun bouton natif supplémentaire n’est annoncé.

### Passer d’un ancien ZIP au catalogue officiel

Après publication du catalogue, fermer les sessions OneAgent actives. Vérifier
avec `copilot plugin list --json` que l’entrée `oneagent` est l’ancienne installation
locale à remplacer. La mémoire doit être dans son dossier séparé, comme prévu par
l’onboarding. Puis :

```sh
copilot plugin marketplace add ValentinDeSmet/OneAgent-release
copilot plugin uninstall oneagent
copilot plugin install oneagent@oneagent
```

Ouvrir une nouvelle session. La liaison `~/.config/oneagent/copilot.json` reste
disponible : l’onboarding ne recrée pas la mémoire. Il s’agit d’un changement de
source d’installation unique ; les mises à jour suivantes utilisent le catalogue.
Le plugin ne désinstalle jamais automatiquement une ancienne installation locale.

### Si le cockpit affiche « OneAgent worker stopped (1) »

Ce message des anciennes versions signifie que le processus moteur s’est arrêté ;
il ne permet pas de conclure à un verrou ou à une corruption de la mémoire.
La version 0.6.3 vérifie le moteur Node.js avant son lancement : le processus
hébergeant un canvas n’est pas nécessairement un exécutable Node.js réutilisable.
Le plugin choisit un Node.js compatible (≥ 22.18, TypeScript actif et `node:sqlite`),
puis attend que le moteur soit prêt avant de lui transmettre une requête.

Les erreurs distinguent désormais un échec avant toute requête d’un résultat
incertain après envoi. Les diagnostics connus indiquent un Node incompatible,
un module manquant ou un accès refusé, sans recopier les sorties brutes du poste.
Aucune écriture n’est répétée automatiquement. Une erreur encore inconnue est
présentée comme telle ; ce correctif ne confirme pas la cause d’une panne à distance.

Si Node.js est introuvable depuis l’application, rendre le même Node compatible
accessible dans son `PATH`. Pour un hôte administré, `ONEAGENT_NODE_PATH` accepte
un chemin absolu vers le Node à utiliser. Le plugin conserve les options et les
restrictions de l’environnement ; il ne change pas les permissions de la mémoire.

## Mémoire, VS Code et plusieurs postes

Le paquet contient uniquement le code. Les notes et la mémoire professionnelle
se transfèrent séparément avec les commandes de sauvegarde/restauration OneAgent.
Il n’existe pas encore de synchronisation automatique entre ordinateurs.

Le plugin conserve le choix local dans `~/.config/oneagent/copilot.json`. Ce fichier
est écrit automatiquement par l’onboarding. Les anciennes liaisons restent
compatibles. Pour un usage avancé, `ONEAGENT_CONFIG` ou `--config` priment et ne
peuvent pas être remplacés par l’onboarding ; `ONEAGENT_COPILOT_SETTINGS` permet de
choisir un autre emplacement du fichier de liaison.

Une mémoire déjà connectée ne sera pas remplacée par l’onboarding. Une modification
de la liaison par une autre session demande une nouvelle session plutôt que de
changer de mémoire au milieu d’une conversation. Les configurations mal formées
ne sont pas écrasées. Un chemin enregistré devenu invalide peut être corrigé avec
le parcours créer/connecter. Après un arrêt forcé pendant l’onboarding, un fichier
`copilot.json.setup-lock` peut subsister : vérifier que les processus de configuration
sont arrêtés avant de retirer ce seul verrou.

Pour travailler simultanément sur **le même dossier local du même ordinateur**,
mettre à jour les deux plugins : **VS Code 0.1.127 et Copilot 0.5.1**, ou versions
ultérieures. Sélectionner dans Copilot le même fichier de configuration mémoire
que dans VS Code. Une ancienne VSIX peut ignorer le verrou commun.

Le verrou protège chaque opération sur SQLite et les fichiers Markdown, puis est
libéré. Une session VS Code ou MCP au repos ne conserve pas ce verrou. Les opérations
concurrentes attendent jusqu’à 30 secondes ; une opération plus longue peut demander
une nouvelle tentative après sa fin. Les hôtes peuvent rester ouverts ensemble.

Après un crash, le moteur récupère automatiquement un verrou valide si le système
confirme que son processus local n’existe plus. Il ne se base jamais uniquement
sur l’âge du verrou. Un propriétaire actif, une vérification refusée, un verrou
incomplet, une récupération interrompue ou un propriétaire d’une autre machine
restent protégés. Ce mécanisme n’est pas une synchronisation réseau.

En cas de blocage persistant, relever le message exact (chemin, PID et date), mettre
à jour les deux plugins, fermer une fois les deux applications puis les relancer.
Un verrou non vérifiable nécessite un diagnostic ; ne pas effacer la base SQLite
ni ses fichiers `-wal` et `-shm`. Les sélections de contexte VS Code ne sont ni
reprises ni modifiées par la connexion Copilot.

## En cas de démarrage impossible

Si Copilot ne trouve pas `node`, vérifier son PATH. Il est aussi possible d’ajouter
un serveur personnalisé dans **Customize → MCP**, avec le chemin absolu du binaire
Node.js comme commande et les arguments `--disable-warning=ExperimentalWarning`,
puis le chemin absolu du fichier `oneagent/start.mjs` du paquet. Le même onboarding
reste disponible. Éviter deux connexions MCP OneAgent actives si cette connexion
remplace celle du plugin.

## Construire depuis les sources

Depuis le dépôt OneAgent :

```sh
pnpm copilot:prepare
pnpm copilot:package
```

Le résultat est `dist/copilot-marketplace/plugins/oneagent`, accompagné du catalogue
`dist/copilot-marketplace/marketplace.json`. Le dossier source `apps/copilot-plugin`
seul n’est pas installable : le moteur est ajouté au build. Le build n’embarque ni
mémoire personnelle ni réglages du poste. Le catalogue local `oneagent-local`
sert au développement ; le catalogue public stable porte le nom `oneagent` et
épingle chaque version sur un commit précis du dépôt de releases.

`copilot:package` produit aussi `dist/oneagent-copilot-0.6.10.zip` et son `.sha256`.
Le pipeline de release publie le VSIX et ce ZIP ensemble, ainsi que le catalogue
installable. Les étapes mainteneur sont décrites dans `docs/copilot-distribution.md`
du dépôt de développement.

## Périmètre et validation

Trois outils d’onboarding permettent de consulter l’état, préparer le choix et le
finaliser. Neuf outils métier couvrent entités, recherche, contexte, sources,
notes privées et sollicitations. Quatre outils gèrent l’état, la vérification, le choix et l’application
des mises à jour. L’onboarding vérifie les destinations et les modifications
concurrentes ; une création ne réutilise jamais un dossier existant, même vide,
et refuse les repos Git, le dossier du plugin et les mémoires imbriquées.

Les tests couvrent un démarrage sans réglage, la création/connexion, la persistance,
l’usage immédiat, les conflits de sessions, le protocole et le paquet autonome.
Ils utilisent uniquement des mémoires temporaires sur macOS. La validation manuelle
dans l’application Copilot et avec le plugin BMAD d’entreprise reste à effectuer.
Les tests de mise à jour utilisent un catalogue HTTP et un gestionnaire de plugins
simulés ; ils ne remplacent pas un essai avec l’hôte Copilot réel.

Une nouvelle note attend son ingestion/curation avant d’apparaître dans la recherche ;
elle est immédiatement disponible via les outils de notes. Le cockpit utilise désormais
le même contrôleur que VS Code pour les notes, le graphe, la curation, les tâches,
le score BMAD et les vues de contexte. La mémoire locale n’est pas automatiquement
disponible dans les sessions cloud.

Références officielles vérifiées le 1er octobre 2026 :

- [Personnaliser l’application Copilot](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
- [Référence des plugins Copilot](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [Spécification Agent Plugins 1.0](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md)


## Le cockpit commun aux deux applications

Demander **« Ouvre le cockpit OneAgent »** pour ouvrir **OneAgent · Cockpit**.
La première ouverture propose de créer ou connecter une mémoire si nécessaire.
Pour retrouver les mêmes données que dans VS Code sur le même Mac, connecter
son fichier de configuration existant. Le plugin et la mémoire restent séparés.

Le paquet contient l’interface complète, son graphe 2D/3D et le contrôleur commun :

| Vue | Fonctions communes |
| --- | --- |
| Graphe | Navigation, filtres, entités, relations, contexte actif, vues enregistrées et Context Packs |
| Notes | Création, édition, questions, archives, rattachement et curation |
| Priorités et tâches | Demandeurs, échéances, suivi, statuts, liens et affectations |
| Inbox | Captures, observations, propositions, preuves et validation humaine |
| Sources | Consultation du contenu et des fichiers référencés |
| Today | Tableau quotidien, missions, OKR, KPI et mesures |
| Réglages et aide | Thème, organisation, diagnostic, documentation et mises à jour |

Dans Copilot, les dialogues et aperçus de fichiers s’affichent dans le canvas.
Les fichiers Markdown/texte de la mémoire et de ses dépôts configurés peuvent
être édités avec contrôle de révision. Un clonage nécessitant une authentification
interactive propose la commande à exécuter dans Terminal. Le bouton de mise à
jour utilise le catalogue Copilot, tandis que VS Code conserve son mécanisme VSIX.

Les passes de curation utilisent les mêmes prompts, outils et règles que VS Code,
via une session isolée du SDK Copilot. Seuls les outils OneAgent autorisés sont
exposés à cette passe ; l’acceptation humaine des propositions reste dans l’Inbox.
L’accès au modèle dépend de l’authentification Copilot du poste. Une indisponibilité
est signalée sans transformer une tentative en succès. Les outils et paramètres
BMAD de la conversation principale restent inchangés.

Le paquet est vérifié automatiquement contre le renderer et le contrôleur source
VS Code. L’ouverture effective du canvas et l’accès au modèle sur l’application
macOS installée restent à valider sur le poste utilisateur ; aucun navigateur
ni plugin installé localement n’a été utilisé pour ces vérifications.

Références SDK consultées le 2 octobre 2026 :
[canvas](https://github.com/github/copilot-sdk/blob/main/nodejs/src/canvas.ts),
[session](https://github.com/github/copilot-sdk/blob/main/nodejs/src/session.ts),
[restriction des outils](https://github.com/github/copilot-sdk/blob/main/nodejs/src/types.ts).

## Priorités : suivre les sollicitations

Après configuration, demander **« Ouvre mes priorités OneAgent »**. Le plugin
fournit le canvas **OneAgent · Priorités** dans le panneau de l’application.
La prise en charge des canvas doit être disponible dans la version de Copilot
utilisée ; les outils conversationnels restent accessibles sans ce panneau.

Le tableau montre le sujet, la personne ou l’équipe qui attend le résultat,
la priorité, l’échéance, l’avancement et la prochaine action. Une fiche permet
l’ajout et la modification. Recherche par sujet/demandeur, filtres sur les
priorités hautes, les retards, les 7 prochains jours et les points à préciser.
Les sollicitations terminées restent consultables et peuvent être rouvertes.

Une échéance peut être ferme, estimée (ex. « courant octobre ») ou inconnue.
Une estimation peut comporter une date cible pour le tri, sans être comptée
comme un retard. L’ordre initial est le classement manuel ; les tris par colonne restent disponibles. Les badges
utilisent la date locale du Mac. Actualisation automatique chaque minute hors
édition, et bouton Actualiser ; aucun rappel ou message externe n’est envoyé.

Les demandes sont des tâches natives assignées à « me », conservées dans la
mémoire choisie lors de l’onboarding, sans projet obligatoire. Les propositions
de l’Inbox ne deviennent pas automatiquement des engagements. Les tâches et
leurs identités sont communes à VS Code ; cet écran est également accessible
dans le cockpit VS Code depuis la version 0.1.126. L’export privé passe au format 3 et conserve la lecture des
formats 1 et 2. Une ancienne version du plugin ne sait pas lire le format 3.

Pour le chat : **« Ajoute une demande de Claire pour préparer le point vendredi,
priorité haute »**, puis vérifier les informations ambiguës avant d’enregistrer.
Les outils sont `oneagent_list_priorities` et `oneagent_save_priority`, avec un
périmètre portfolio explicite. L’écriture protège contre les fiches devenues
obsolètes ; recharger et rouvrir une fiche si elle a changé dans un autre hôte.

Canvas basé sur le contrat SDK public GitHub, testé hors de l’application avec
des mémoires temporaires. L’affichage et l’ouverture dans l’application réelle
restent à valider sur le poste équipé de Copilot.

Référence vérifiée le 2 octobre 2026 :
[Canvas GitHub Copilot](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions).

## Priorités intégrées (0.6.0)

L’écran Priorités du cockpit partage les couleurs, boutons, champs et thèmes
clair/sombre du reste de OneAgent. Le tableau affiche sujet, description, produit
concerné, attendu par, priorité, deadline, URL et avancement. Cliquer sur les
en-têtes pour trier dans les deux sens ; les filtres par champ sont combinables.

Chaque création ou édition requiert une entité existante. Le produit concerné
est facultatif pour les entités d’un autre type ; une entité produit renseigne
son propre produit. Les anciennes demandes sans lien restent visibles sous
**Sans entité · à rattacher**. Aucun rattachement n’est inventé automatiquement.

L’agent peut créer et modifier ces informations avec `oneagent_save_priority`,
après lecture des entités et révisions via `oneagent_list_priorities`. VS Code
0.1.132 expose les mêmes actions. Après mise à jour du plugin, ouvrir une nouvelle
session Copilot pour charger le nouveau front et les outils.

### Fiches du graphe (0.6.3)

Le clic sur une entité ouvre sa fiche et son contenu wiki dans le cockpit, même
lorsqu’elle est hors du contexte strict actif de l’agent. Cette consultation
manuelle utilise la même mémoire que le graphe ; elle ne modifie ni la sélection
ni les droits de lecture du contexte de l’agent.

En cas d’échec, la fiche et l’espace de travail affichent le diagnostic et un
bouton **Retry**. Une absence de réponse au bout d’une minute laisse aussi la
possibilité de réessayer ; aucune requête n’est répétée automatiquement.

### Priorités transverses (0.6.4)

La fiche distingue **Produit principal** et **Autres produits / équipes**. Le
filtre visible **Produit / équipe concerné** retrouve une participation principale
ou partenaire ; les filtres avancés peuvent cibler l’un des deux rôles.

**URL documentation** conserve le lien du sujet. **URL source** accueille le
Google Sheet d’origine, éventuellement avec son onglet ou sa ligne. L’agent peut
retrouver ce lien lors d’une demande d’actualisation ; aucun accès automatique
au fichier distant n’est déclenché par son enregistrement.

**En cours** s’ajoute aux états existants et reste cohérent avec Tasks et Today.
Le filtre **Nature** affiche sujets et tâches, sujets uniquement ou tâches
uniquement. La classification se modifie dans la fiche ; l’affichage par défaut
conserve les deux listes. Les compteurs respectent les filtres de champ.

### Classement manuel (0.6.5)

**Mon classement** est l’affichage par défaut. Glisser la poignée ⠿ avant ou après
une ligne pour changer sa place, ou la sélectionner et utiliser les flèches haut
et bas. Les filtres conservent l’ordre relatif des sujets masqués. Le bouton
**Mon classement** retrouve cet ordre après un tri par colonne, sans changer les
priorités haute/basse, les dates, les liens ou l’avancement.

L’ordre est enregistré dans la mémoire commune à VS Code 0.1.132 et Copilot.
Avant le premier déplacement, il reprend priorité puis date ; après classement,
les nouvelles lignes arrivent en fin de liste. Les déplacements concurrents
sont détectés : actualiser la liste avant de réessayer. L’agent peut aussi placer
un sujet avant/après un autre avec `oneagent_reorder_priority`, à ta demande
explicite, après lecture de la révision du classement.
