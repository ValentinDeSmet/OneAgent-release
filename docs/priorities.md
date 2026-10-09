# Priorités — sollicitations personnelles

Mise à jour du 9 octobre 2026, Copilot 0.6.19 et VS Code 0.1.142. Le catalogue public
`ValentinDeSmet/OneAgent-release` distribue le front et le moteur dans un même
plugin ; aucune installation séparée de l’interface n’est nécessaire.

## Usage et choix de présentation

Un tableau permet de comparer des demandes sans lien entre elles : une ligne
par résultat attendu : sujet, description, type de travail, produit principal, autres produits ou
équipes concernés, attendu par, priorité, deadline, documentation, source et
avancement. L’entité rattachée figure sous le sujet. Une fiche d’édition conserve le contexte sans alourdir la lecture.

Le tableau reprend les mêmes contrôles et le même design que **Mémoire**.
**Colonnes** permet d’afficher ou masquer les propriétés, puis de les déplacer
avec les flèches du menu ou en glissant leur en-tête. Le bord droit règle la
largeur ; les flèches gauche/droite du clavier font le même réglage. Sujet et
Rang restent accessibles. Chaque vue enregistre ses colonnes, leur ordre et leur
largeur. Déplacer une colonne ne change jamais le classement des priorités.

Cliquer sur l’icône de filtre d’un en-tête pour filtrer sa colonne : recherche et
cases multiples pour les catégories, texte pour sujet/description/demandeur/liens,
trimestre, année et dates dans **Échéance**. **Sujet** inclut aussi la nature et
l’entité rattachée ; **Produit principal** propose le produit principal ou tout
produit/équipe concerné, et **Autres produits / équipes** cible les partenaires.
Les choix viennent des résultats avant pagination. Les colonnes filtrées restent
visibles jusqu’au retrait de leur filtre, même si aucun résultat ne correspond.
La recherche générale, le choix actifs/terminés/retirés et les alertes restent
au-dessus du tableau. Le classement manuel et les accordéons de tâches sont conservés.

La liste contient seulement les sollicitations créées dans Priorités et les tâches
ajoutées explicitement. Créer une tâche dans Tâches ne l’inscrit jamais automatiquement,
même avec une urgence critique ou une deadline. Pour y inclure une tâche personnelle,
ouvrir sa fiche et choisir **Ajouter aux priorités**. Son entité est reprise lorsqu’elle
est sans ambiguïté ; sinon un choix parmi les entités existantes est demandé. Enregistrer
les modifications de la fiche avant de changer ce suivi. La tâche conserve son ID,
son état, sa description, ses notes, sa source et ses liens : aucune copie n’est créée.
**Retirer des priorités** dans cette même fiche conserve la tâche dans Tâches.

- Ajouter une sollicitation avec une entité existante obligatoire (projet, produit,
  personne ou autre type du graphe). Le produit est facultatif pour les autres
  entités ; une entité produit renseigne ce même produit.
- Ajouter plusieurs produits ou équipes partenaires depuis toute la mémoire,
  sans les limiter au produit principal. Le champ permet une recherche et un
  choix multiple ; les partenaires doivent être des entités existantes.
- Distinguer le lien de documentation (`url`) de l’URL du Google Sheet d’origine
  (`sourceUrl`). Le lien source reste disponible pour une demande d’actualisation
  à l’agent ; son enregistrement ne déclenche pas une synchronisation distante.
- Classer chaque priorité comme sujet à développer ou tâche/action. Le filtre
  **Sujets et tâches** porte uniquement sur les éléments déjà suivis comme priorités ;
  il ne fait pas apparaître les tâches ordinaires. La classification reste modifiable.
- Choisir une priorité basse, normale, haute ou critique.
- Indiquer une date ferme avec le calendrier, une période **Q1, Q2, Q3 ou Q4**
  avec une année, ou laisser l’échéance à préciser. Le trimestre et l’année se
  choisissent par listes déroulantes ; aucune nouvelle période libre n’est acceptée.
  Seules les dates fermes peuvent être signalées en retard.
- Choisir le type de travail : **Discovery**, **Étude technique**,
  **Développement / implémentation**, **Validation / recette**, **Documentation**
  ou **Autre**. **À préciser** conserve les anciennes lignes sans supposition.
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
demandeur, priorité, type de travail, trimestre, année, intervalle de dates, nature de la deadline, documentation,
source et avancement sont combinables. Le filtre **Produit / équipe
concerné**, dans la colonne Produit principal, retrouve l’entité comme produit principal, rattachement produit/équipe
ou partenaire ; les filtres de colonnes **Produit principal** et **Produit / équipe
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
`priorities list|save|promote|reorder|delete|tasks|task-attach|task-detach|task-save --stdin --json`. Ces commandes exigent un périmètre portfolio
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
`itemType`, `relatedEntityRefs`, `manualRank`, `inPriorities`, `priorityRemoved`,
`deadlineQuarter`, `deadlineYear` et `workType`.
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
priorités personnelles non archivées, même hors filtres ou pagination. Le serveur
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
Depuis Copilot 0.6.11, OneAgent demande le rechargement du plugin dans la conversation
courante après fermeture de ses Canvas et fin des opérations en cours. Le moteur
chargé doit confirmer la nouvelle version ; la simple réouverture du Canvas ne
recharge pas les modules en mémoire. Voir le [guide Copilot](../apps/copilot-plugin/README.md#recharger-sans-recommencer-le-chat).

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

## Filtres multiples et suppression

Les menus Nature, Produit / équipe concerné, Avancement, Attention particulière,
Entité rattachée, Produit principal, Partenaire, Priorité, Type de travail,
Trimestre, Année et Nature de la deadline
proposent des cases à cocher et une recherche. Aucune sélection signifie « tout
Afficher ». Plusieurs valeurs d’un même champ sont combinées par **ou**, et les
champs entre eux par **et**. Recherche textuelle et intervalle de dates restent
indépendants ; Afficher choisit les sollicitations actives, terminées ou toutes.

Les choix viennent de toutes les sollicitations de la vue avant pagination, et
non de l’ensemble des entités du graphe. Chaque menu tient compte des autres
filtres mais ignore sa propre sélection, afin de permettre l’ajout d’une autre
valeur. Un choix sélectionné devenu indisponible reste décochable avec compteur
zéro ; il n’est jamais effacé silencieusement. Les champs de création et de
modification conservent toutes les entités actives comme choix possibles.
L’agent peut envoyer une chaîne (compatibilité) ou un tableau de valeurs dans
les filtres catégoriels. La réponse de liste ajoute `facets` ; `entities` conserve
son rôle de choix complet pour l’édition.

Le crayon ouvre la fiche de modification. Le menu **⋯** contient **Retirer des
priorités**, disponible aussi dans la fiche. La confirmation rappelle que seule
la présence dans cette liste change : la tâche native conserve son ID, son état
d’avancement, ses informations, ses notes, sa source et tous ses liens entrants
et sortants. Elle reste disponible dans Tâches et Today selon leurs filtres.

Le champ durable `tracking.inPriorities=false` exclut l’élément des vues actives,
terminées et toutes, des compteurs, des facettes et du classement des priorités.
Les anciennes priorités créées explicitement (nature dans `tracking`, champs de
sollicitation ou lien `priorityPrimary`) restent incluses pour compatibilité. Une
tâche ancienne sans ces informations reste une tâche ordinaire ; son urgence,
sa deadline, son produit ou un rang manuel ne suffisent pas à l’inscrire. Une
modification ordinaire depuis Tâches ou par l’agent ne réactive pas cet indicateur.
L’export privé et la restauration conservent ce champ dans le suivi de la tâche.

La vue **Retirées des priorités** (`view=excluded`) permet de retrouver les éléments
retirés, puis de choisir **Remettre dans mes priorités** dans le menu ou la fiche.
Cela conserve la même identité et ne crée aucune tâche supplémentaire. Le
classement manuel est désactivé dans cette vue. Les nouvelles tâches ordinaires
portent `inPriorities=false` et `priorityRemoved=false` : elles ne sont pas des
priorités retirées. Un retrait explicite inscrit `priorityRemoved=true`.

Pour ajouter une tâche existante à la demande de l’utilisateur, l’agent lit
`oneagent_list_tasks` / `workMemory_readTasks`, puis appelle
`oneagent_promote_task_to_priority` / `workMemory_promoteTaskToPriority` avec
`scope=portfolio`, son ID et sa `priorityRevision`. Une entité existante est obligatoire
si le rattachement ne peut pas être repris sans ambiguïté. Cette opération garde
tous les champs de la tâche ; elle ajoute seulement le suivi et le lien principal
nécessaire. Les propositions Inbox/concept n’ont pas cette révision et ne sont pas
promouvables. Les règles de contexte strict de l’agent restent appliquées.

`oneagent_delete_priority` et `workMemory_deletePriority` conservent leur nom pour
compatibilité mais retirent uniquement la ligne des priorités. Ils utilisent
`taskId` et la `revision` de la dernière lecture. Pour la remise en liste, lire
`view=excluded`, puis appeler l’outil de sauvegarde avec `inPriorities=true` et
la révision courante. Si seuls ces champs sont envoyés, aucun autre champ ni lien
n’est modifié, même pour une tâche ancienne sans entité rattachée.

Une modification concurrente ou une tâche hors des sollicitations personnelles
est refusée sous transaction. Une erreur ne déclenche aucun nouvel essai
automatique ; relire la liste avant de réessayer. Une disparition dans un Google
Sheet ne constitue pas une instruction de retrait.


## Trimestres et tâches rattachées

Les filtres Type de travail, Trimestre et Année utilisent les valeurs présentes
dans les priorités, avec choix multiple. Une période Q1–Q4 et son année déterminent
une date de fin de trimestre pour le tri, sans devenir une date ferme dans Today.
Les anciennes périodes `Q2 2027` / `T2 2027` sont reconnues à la lecture ; le stockage
n’est pas modifié automatiquement. Une période ambiguë reste affichée et conservée
jusqu’à son remplacement explicite dans la fiche. Les modifications API qui omettent
les champs de période conservent cette information historique.

Sous le sujet, **Tâches · terminées/total** ouvre un accordéon. **Ajouter une tâche**
permet de créer une tâche native ou de sélectionner une tâche déjà présente dans
Tâches, avec recherche et pagination. Le crayon modifie cette même tâche ;
**Détacher** retire uniquement son association avec cette priorité. Depuis une
fiche Tâches, **Gérer les priorités liées** propose le rattachement ou le détachement.
Enregistrer les modifications de la fiche avant cette action.

Une tâche peut servir plusieurs priorités. Son ID, son avancement et ses informations
sont communs à toutes les vues ; aucune copie n’est créée. Une nouvelle tâche hérite
du produit et de l’entité de sa priorité, mais ne devient pas elle-même une priorité.
Retirer une priorité du suivi conserve les tâches rattachées. Archiver une tâche
la retire de l’accordéon et de ses compteurs.

L’association est un lien natif `supports` de la tâche vers la priorité, marqué
`metadata.priorityWork=true`. Les liens antérieurs et leur provenance sont conservés ;
les éditions ordinaires dans Tâches ne perdent pas l’association. L’export privé
conserve les champs et les liens sans migration SQL supplémentaire.

L’agent dispose de `oneagent_list_priority_tasks`, `oneagent_attach_priority_task`,
`oneagent_detach_priority_task` et `oneagent_save_priority_task`, avec leurs équivalents
VS Code `workMemory_listPriorityTasks`, `workMemory_attachPriorityTask`,
`workMemory_detachPriorityTask` et `workMemory_savePriorityTask`. La lecture renvoie
la révision de la priorité et celle de chaque tâche ; les écritures vérifient les
deux sous transaction. Les cycles et rattachements à soi-même sont refusés. Un échec
incertain ne rejoue aucune écriture et conserve le brouillon du formulaire.


## Vues enregistrées

Les onglets et le sélecteur **Toutes les vues** reprennent la présentation de
Mémoire. **+ Vue** crée une vue sans filtre, avec le classement manuel et les
colonnes par défaut. **Enregistrer sous…** sauvegarde la recherche, les filtres,
le tri et les colonnes actuels sous un autre nom. Les critères restent dynamiques :
une nouvelle priorité correspondante apparaît sans réenregistrer la vue.

Exemples à créer avec tes critères, sans ajouter de données de démonstration :

- **Q4 2026** : trimestre Q4, année 2026, avancement souhaité.
- **Préparation Q1 2027** : Q1, année 2027, tri par échéance.
- **DKT FF** : Produit / équipe concerné DKT FF, tri par priorité ou classement.

Cliquer sur un onglet réapplique ses critères. Les changements temporaires portent
l’indicateur **Modifiée** : **Enregistrer** les enregistre explicitement.
**Rétablir la vue**, dans le menu **…**, retrouve les filtres, le tri et les colonnes sauvegardés.
Le menu **⋯** de la vue permet de renommer, dupliquer, choisir la vue d’ouverture
par défaut ou supprimer la vue. Une suppression ne retire aucune priorité et
conserve les filtres courants en vue libre. L’étoile identifie la vue par défaut.

Une vue enregistre le tri, son sens, les colonnes visibles, leur ordre et leur largeur. **Mon classement** reste le classement
global partagé ; chaque vue peut utiliser un tri par colonne différent. Il ne
s’agit pas d’un classement manuel indépendant par vue ni d’une photographie des
éléments présents. La date locale des alertes est recalculée à chaque lecture ;
les pages et accordéons ouverts ne font pas partie des critères sauvegardés.

Les anciennes vues gardent leurs critères et reçoivent la présentation par défaut jusqu’à une sauvegarde explicite. Renommer ou modifier seulement les filtres via l’agent conserve les colonnes enregistrées.

Les vues et leur défaut sont conservés sous `prioritySavedViews` dans la mémoire
SQLite commune. Elles survivent au rechargement des plugins et à l’export/restauration
privé structuré, sans nouvelle migration SQL. Elles ne modifient ni la sélection
du graphe ni les autorisations de contexte de l’agent. Une vue supprimée sur un
autre hôte conserve les filtres de l’écran courant ; elle ne les élargit pas
silencieusement. Les noms sont uniques et la liste est limitée à 50 vues.

L’agent utilise `oneagent_list_priority_views`, `oneagent_save_priority_view` et
`oneagent_delete_priority_view`, ou `workMemory_listPriorityViews`,
`workMemory_savePriorityView` et `workMemory_deletePriorityView` dans VS Code.
Les écritures portent la révision de collection issue de la dernière lecture :
un enregistrement concurrent est refusé sous transaction. Pas de sauvegarde
automatique des ajustements temporaires ni de répétition après une erreur
incertaine. Les appels agent restent soumis au contexte strict actif.

Le champ optionnel `presentation` de `oneagent_save_priority_view` contient `columns`, `columnOrder` et `widths`. Il est indépendant des critères et du classement global ; omis sur une mise à jour, il reste intact. Les exports privés conservent ces réglages.
