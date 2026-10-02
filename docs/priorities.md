# Priorités — sollicitations personnelles

Implémentation du 2 octobre 2026, Copilot 0.4.0. Le catalogue public
`ValentinDeSmet/OneAgent-release` distribue le front et le moteur dans un même
plugin ; aucune installation séparée de l’interface n’est nécessaire.

## Usage et choix de présentation

Un tableau permet de comparer des demandes sans lien entre elles : une ligne
par résultat attendu, avec demandeur, priorité, échéance, avancement et prochaine
action. Une fiche d’édition conserve le contexte sans alourdir la lecture.

- Ajouter une sollicitation, sans projet obligatoire.
- Choisir une priorité basse, normale, haute ou critique.
- Indiquer une date ferme, une estimation libre (date cible facultative) ou laisser
  l’échéance à préciser. Seules les dates fermes peuvent être signalées en retard.
- Retrouver un sujet ou un demandeur via la recherche.
- Filtrer les sujets actifs/terminés, les priorités hautes, les retards, les
  échéances d’ici 7 jours, les attentes ou les informations à préciser.
- Modifier ou terminer une demande ; les demandes terminées peuvent être rouvertes.

Le tri compare d’abord la priorité choisie, puis les dates. Il n’y a pas de score
opaque qui requalifie automatiquement une demande. Les compteurs portent sur
l’ensemble des tâches actives, indépendamment de la recherche. « À préciser »
signifie demandeur absent ou échéance inconnue. Le tableau se recharge chaque
minute lorsqu’aucune fiche n’est en cours d’édition et lorsque le panneau est
visible. La date de mise à jour figure dans la fiche ; ce n’est pas un journal
complet des changements.

## Copilot et mémoire commune

Le canvas `oneagent-priorities` est livré dans
`com.github.copilot/extensions/oneagent-priorities/`, conformément au format
Agent Plugins 1.0. Il réutilise la liaison mémoire de l’onboarding, les outils
`oneagent_list_priorities` / `oneagent_save_priority` et les commandes CLI
`priorities list|save --stdin --json`. Ces commandes exigent un périmètre portfolio
explicite et refusent d’élargir implicitement un contexte strict actif.

Les demandes sont des tâches natives assignées à `me`. Les propositions Inbox,
les tâches agent et les archives ne deviennent pas des engagements personnels.
Les tâches identiques par leur titre gardent des identifiants distincts. Les
liens, notes et références des tâches existantes sont conservés à l’édition.

La migration 016 ajoute un objet `tracking_json` aux tâches : `requester`,
`deadlineKind`, `deadlineLabel`, `targetDate`, `nextAction`. La date ferme reste
le champ `deadline` existant. Les estimations n’alimentent pas ce champ afin que
Today et les anciens clients n’affichent pas de faux retards. Une date ferme
ajoutée ensuite depuis VS Code prévaut sur l’estimation.

Les deux plugins conservent la même base. Cette livraison ajoute l’écran dans
Copilot ; la vue VS Code dédiée n’est pas incluse. Les anciennes tâches restent
compatibles. L’export privé passe au format 3 et restaure les formats 1 et 2.
Il ne s’agit pas d’une synchronisation automatique entre deux ordinateurs.

## Écritures et contrat hôte

Une révision calculée sur le contenu de la tâche protège chaque édition :
relecture et écriture s’exécutent dans la même transaction. Une fiche obsolète
est refusée avec un message demandant son actualisation. Les champs omis restent
intacts ; une chaîne vide efface un texte facultatif. Les créations ne sont pas
réessayées automatiquement après une erreur réseau.

Le canvas utilise le SDK fourni par Copilot pour `createCanvas` et `joinSession`.
Le serveur local écoute uniquement sur `127.0.0.1`, avec un secret par instance,
contrôle de Host/Origin, CSP et limite de requête. Aucun serveur réseau distant,
aucune installation de dépendance à l’ouverture, aucune donnée privée dans le
répertoire du plugin. Les appels libèrent le verrou mémoire après l’opération.
Les sessions chargées avant une mise à jour sont bloquées jusqu’à leur réouverture.

Références officielles consultées le 2 octobre 2026 :

- [Canvas de l’application Copilot](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions)
- [Format et création de plugins](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [SDK d’extension](https://github.com/github/copilot-sdk/blob/main/nodejs/src/extension.ts)

## Validation et limites

Tests automatisés : données et migrations sur bases temporaires, anciens exports,
création/modification via MCP et CLI, pagination et dates locales, conflits
d’édition, serveur local et contrôle des requêtes, paquet autonome et contrôles
VS Code. Aucun navigateur ni application Copilot installé n’est utilisé.

L’ouverture et le rendu réels du canvas dans Copilot macOS, ainsi que la
cohabitation avec le plugin BMAD d’entreprise, restent à valider sur le poste
équipé. Le tableau peut aussi être consulté dans le chat via les outils MCP.
La saisie est manuelle ou conversationnelle : pas d’ingestion automatique des
messages, de relances externes ou de notifications dans cette version.
