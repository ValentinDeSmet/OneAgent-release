# Ma mission, entretiens et bilan

La page **Ma mission** est partagée par VS Code et Copilot. Elle propose trois onglets : Mission, Entretiens et Bilan. Tout reste dans la mémoire privée liée au plugin ; aucune soumission à un outil RH n'est effectuée.

## Mission

Créer une mission annuelle ou reprendre une mission déjà présente dans OneAgent. Renseigner le rôle, le périmètre, les dates, les managers et le rôle additionnel. Chaque objectif contient des résultats clés/KPIs, les critères de réussite et cibles, les actions et livrables, une priorité Must Win/Important/Complémentaire et un avancement. Les objectifs et KPIs réutilisent le modèle natif de OneAgent ; les valeurs mesurées sont datées et peuvent avoir une URL source.

**Nouvelle version / périmètre** conserve la précédente version avec sa période et la raison du changement. Les objectifs peuvent ensuite être adaptés au nouveau rôle. Les anciennes attentes restent consultables et ne doivent pas être présentées comme des échecs du nouveau périmètre.

**Contributions hors mission** conserve les réalisations imprévues, leur impact, leur date et leurs preuves, même sans objectif associé. On peut les saisir ici ou utiliser **À valoriser dans un EI** dans une fiche de tâche, de note ou le menu d'une priorité. La tâche ou la note d'origine reste la même ; aucun changement de priorité n'est impliqué.

## Entretiens

Créer un EI avec sa date et la période couverte. OneAgent sélectionne la version de mission applicable, prend un point daté sur les indicateurs et reprend les décisions du dernier entretien réalisé. Les contributions saisies dans la mission pendant la période sont proposées dans l'EI, avec les mêmes identifiants pour éviter de les compter deux fois dans le bilan.

Les rubriques sont : ce que j'ai aimé et moins aimé vivre, synthèse du ressenti, décisions et apprentissages, performance, nouvelles décisions et retours après l'entretien. On peut commenter les réalisations et difficultés pour chaque objectif, suivre les engagements précédents et ajouter des décisions. **Créer une tâche** transforme une décision en tâche ordinaire, une seule fois ; son ajout aux priorités reste un choix distinct.

**Actualiser les indicateurs** reprend les mesures de la période, sans remplacer les objectifs ou le texte déjà rédigé. **Marquer comme réalisé** conserve cet entretien et son point daté. Pour le corriger ensuite, **Ajouter une correction** préserve la version précédente avant de rouvrir le document.

## Rédaction et enregistrement

Les champs sont enregistrés automatiquement en arrière-plan. Le statut indique les modifications en attente, l'enregistrement ou sa confirmation. Une réponse tardive ne remplace pas ce qui a été tapé entre-temps.

En cas de conflit, le brouillon reste affiché. **Actualiser** permet de relire la version enregistrée et de choisir explicitement de la charger ; annuler conserve le brouillon. Une création conserve son identifiant en cas de coupure pour éviter les doublons.

L'aide à la rédaction utilise Copilot et un contexte privé de la période : mission, EI, notes et tâches, ainsi que les contributions consignées. Les propositions peuvent être modifiées, appliquées ou écartées. L'IA ne doit inventer ni ressenti, ni mesure, ni accord du manager ; chaque source disponible est proposée à la consultation. Les champs existants sont conservés lors de l'application d'une suggestion. Un passage IA se limite à la rédaction et n'a aucun outil de modification ou de partage. Les écritures dans le cockpit restent disponibles pendant sa préparation.

## Bilan

Choisir l'année et la mission. Le suivi présente les différentes versions de périmètre, les entretiens réalisés, les mesures datées, les réalisations liées aux objectifs et les contributions hors mission avec leur impact. Les contributions communes à plusieurs EI sont regroupées par leur identifiant, avec leurs références d'entretien. Les EI en préparation peuvent être inclus explicitement.

La trame du bilan peut être modifiée, enregistrée et copiée, ou enrichie par une proposition de l'IA. Un bilan rédigé reste un document conservé ; le suivi et les entretiens constituent les sources pour le faire évoluer.

## Documents et agent

Les documents structurés et leur texte lisible sont conservés en Markdown sous `wiki/missions/<id>/` : `career.md`, `ei-<id>.md` et `bilan-<année>.md`. Ils sont indexés pour la recherche et accessibles depuis Mémoire. Les sauvegardes utilisent les révisions des documents pour détecter une modification dans l'autre plugin.

L'agent utilise **OneAgent Career** dans VS Code ou `oneagent_career` dans Copilot. Lire `list` avant une écriture et conserver les identifiants/révisions. Les opérations principales sont `mission-save`, `mission-version`, `interview-create`, `interview-save`, `measure`, `contribution-save`, `decision-task`, `context`, `bilan` et `bilan-save`. Les outils exigent un portfolio explicite ; un contexte agent strict doit être quitté explicitement avant d'accéder à ce suivi transversal.
