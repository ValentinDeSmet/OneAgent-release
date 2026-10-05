# Priorités — sollicitations personnelles

Mise à jour du 5 octobre 2026, Copilot 0.6.5 et VS Code 0.1.131. Le catalogue public
`ValentinDeSmet/OneAgent-release` distribue le front et le moteur dans un même
plugin ; aucune installation séparée de l’interface n’est nécessaire.

## Usage et choix de présentation

Un tableau permet de comparer des demandes sans lien entre elles : une ligne
par résultat attendu : sujet, description, produit principal, autres produits ou
équipes concernés, attendu par, priorité, deadline, documentation, source et
avancement. L’entité rattachée figure sous le sujet. Une fiche d’édition conserve le contexte sans alourdir la lecture.

- Ajouter une sollicitation avec une entité existante obligatoire (projet, produit,
  personne ou autre type du graphe). Le produit est facultatif pour les autres
  entités ; une entité produit renseigne ce même produit.
- Ajouter plusieurs produits ou équipes partenaires depuis toute la mémoire,
  sans les limiter au produit principal. Le champ permet une recherche et un
  choix multiple ; les partenaires doivent être des entités existantes.
- Distinguer le lien de documentation (`url`) de l’URL du Google Sheet d’origine
  (`sourceUrl`). Le lien source reste disponible pour une demande d’actualisation
  à l’agent ; son enregistrement ne déclenche pas une synchronisation distante.
- Classer chaque ligne comme sujet à développer ou tâche/action. L’affichage
  initial garde **Sujets et tâches**, avec un filtre pour ne voir que l’un ou
  l’autre ; la classification reste modifiable dans la fiche.
- Choisir une priorité basse, normale, haute ou critique.
- Indiquer une date ferme, une estimation libre (date cible facultative) ou laisser
  l’échéance à préciser. Seules les dates fermes peuvent être signalées en retard.
- Retrouver un sujet ou un demandeur via la recherche.
- Filtrer les sujets actifs/terminés, les priorités hautes, les retards, les
  échéances d’ici 7 jours, les attentes ou les informations à préciser.
- Utiliser **En cours** lorsque le travail a commencé ; cet état reste reconnu
  dans Tasks, Today et les fiches d’entités.
- Cliquer sur le titre ou **Modifier** pour modifier ou terminer une demande ;
  les demandes terminées peuvent être rouvertes.

L’affichage initial utilise **Mon classement**, avec une poignée ⠿ et le rang
portfolio de chaque ligne. Glisser la poignée au-dessus ou en dessous d’une
ligne pour enregistrer le nouvel ordre. La poignée accepte aussi les flèches
haut et bas au clavier. Les produits, équipes, sujets et tâches partagent un
même ordre ; les filtres masquent seulement des lignes, en conservant l’ordre
relatif des autres. Les rangs peuvent donc avoir des trous dans une vue filtrée.
Les sujets terminés conservent leur place pour une éventuelle réouverture.

Avant le premier déplacement, l’ordre reprend priorité puis date pour garder
les repères existants. Après classement, les nouvelles lignes arrivent en fin
de liste. Une modification de priorité ou de deadline ne réordonne pas les
lignes déjà classées. Chaque en-tête alterne croissant, décroissant puis retour
au classement manuel ; **Mon classement** permet aussi ce retour directement.
Le glisser-déposer est disponible uniquement dans le classement manuel. Les filtres par sujet, description, entité, produit,
demandeur, priorité, intervalle de dates, nature de la deadline, documentation,
source et avancement sont combinables. Le filtre visible **Produit / équipe
concerné** retrouve l’entité comme produit principal, rattachement produit/équipe
ou partenaire ; les filtres avancés **Produit principal** et **Produit / équipe
partenaire** ciblent chaque rôle séparément. Tris et filtres s’appliquent avant la pagination. Il n’y a pas de score
opaque qui requalifie automatiquement une demande. Les compteurs portent sur
les lignes actives correspondant aux filtres de champ, à la recherche et à la
nature sélectionnée, avant pagination. Le choix d’une métrique ne réduit pas
les autres compteurs à cette seule catégorie. « À préciser »
signifie demandeur absent, échéance inconnue ou entité à rattacher. Le tableau se recharge chaque
minute lorsqu’aucune fiche n’est en cours d’édition ni déplacement en cours et lorsque le panneau est
visible. La date de mise à jour figure dans la fiche ; ce n’est pas un journal
complet des changements.

## Copilot et mémoire commune

Le canvas `oneagent-priorities` est livré dans
`com.github.copilot/extensions/oneagent-priorities/`, conformément au format
Agent Plugins 1.0. Il réutilise la liaison mémoire de l’onboarding, les outils
`oneagent_list_priorities` / `oneagent_save_priority` et les commandes CLI
`priorities list|save|reorder --stdin --json`. Ces commandes exigent un périmètre portfolio
explicite. Les appels agent utilisent le contexte actif et refusent d’élargir
implicitement un contexte strict. Le canvas et le cockpit manuels restent des
vues portfolio explicites, sans modifier le contexte actif de l’agent.

Les demandes sont des tâches natives assignées à `me`. Le lien principal est un
lien `about` vers l’entité, marqué `priorityPrimary` dans ses métadonnées. Un
changement de rattachement retire uniquement l’ancien lien créé par cette vue ;
les liens préexistants et les autres relations restent conservés. Les partenaires
créent des liens `concerns` marqués `priorityRelated` : le retrait d’un partenaire
ne supprime que les liens créés par cette vue, et conserve les liens antérieurs. Les tâches
anciennes avec un seul lien `about` valide ou un produit explicite conservent ce
rattachement. Les tâches orphelines ou ambiguës restent dans **À rattacher** et
exigent un choix à la prochaine édition. Les propositions Inbox,
les tâches agent et les archives ne deviennent pas des engagements personnels.
Les tâches identiques par leur titre gardent des identifiants distincts. Les
liens, notes et références des tâches existantes sont conservés à l’édition.

La migration 016 ajoute un objet `tracking_json` aux tâches : `requester`,
`deadlineKind`, `deadlineLabel`, `targetDate`, `nextAction`, `url`, `sourceUrl`,
`itemType`, `relatedEntityRefs` et `manualRank`.
Aucune nouvelle migration SQL n’est nécessaire. Les anciennes lignes créées dans
Priorités (lien principal `priorityPrimary`) sont lues comme sujets ; les autres
tâches restent des tâches. Une classification explicite prévaut toujours. La date ferme reste
le champ `deadline` existant. Les estimations n’alimentent pas ce champ afin que
Today et les anciens clients n’affichent pas de faux retards. Une date ferme
ajoutée ensuite depuis VS Code prévaut sur l’estimation.

Les deux plugins conservent la même base. Depuis Copilot 0.5.0 et VS Code
0.1.126, le même écran Priorités est également intégré au cockpit commun. Les anciennes tâches restent
compatibles. L’export privé passe au format 3 et restaure les formats 1 et 2.
Il ne s’agit pas d’une synchronisation automatique entre deux ordinateurs.

## Écritures et contrat hôte

Une révision calculée sur le contenu de la tâche et ses liens protège chaque édition :
relecture et écriture s’exécutent dans la même transaction. Une fiche obsolète
est refusée avec un message demandant son actualisation. Les champs omis restent
intacts ; une chaîne vide efface un texte facultatif et `relatedEntityRefs: []`
retire les partenaires. Les créations ne sont pas
réessayées automatiquement après une erreur réseau.

Le déplacement utilise `taskId`, `targetTaskId`, `position: before|after` et le
`orderRevision` global renvoyé par la liste. La révision porte sur toutes les
lignes personnelles non archivées, même hors filtres ou pagination. Le serveur
recalcule l’ordre sous transaction, refuse une révision périmée et enregistre
des rangs entiers. Toute autre ligne conserve son ordre relatif. Les champs et
liens restent intacts, y compris lors d’une actualisation concurrente d’une
source. Une erreur suspend les déplacements jusqu’à une nouvelle lecture,
sans répéter l’écriture. L’agent dispose de `oneagent_reorder_priority` et
`workMemory_reorderPriority` ; il ne classe qu’à la demande explicite de
l’utilisateur, après relecture de la liste.

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

## Intégration et agent

Le composant intégré hérite des variables de thème du cockpit, sans palette
indépendante dans son Shadow DOM. La version canvas autonome utilise les mêmes
valeurs par défaut. Les URLs HTTP(S) sont ouvertes par l’hôte ; les descriptions
et labels sont affichés comme du texte. Un enregistrement confirmé actualise les
autres vues sans transformer une erreur d’actualisation en échec d’écriture.

Copilot expose `oneagent_list_priorities` / `oneagent_save_priority` ; VS Code
expose `workMemory_listPriorities` / `workMemory_savePriority`, avec les mêmes
schémas. L’agent peut modifier tous les champs de la fiche à la demande de
l’utilisateur, en conservant les champs omis et la révision courante. Une URL
non HTTP(S), une entité inexistante/archivée ou un produit incohérent sont refusés.
Les règles de périmètre strict restent appliquées.
