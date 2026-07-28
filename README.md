# Guide d'installation de OneAgent

Ce guide est destiné à tous les utilisateurs, sans connaissance technique
particulière. Suis simplement les étapes dans l'ordre.

## Ce qui va être installé

OneAgent utilise trois éléments :

1. **OneAgent**, l'extension qui s'affiche dans Visual Studio Code ;
2. **oMLX**, une petite application qui exécute les recherches intelligentes
   directement sur le Mac ;
3. **BGE-M3**, le modèle local utilisé par oMLX pour comprendre le sens des
   textes.

Tout fonctionne localement : les documents, la base OneAgent et les embeddings
ne sont pas envoyés sur Internet.

## Avant de commencer

Vérifie les points suivants :

- tu utilises un Mac avec une puce Apple M1, M2, M3, M4 ou plus récente ;
- ton Mac utilise macOS 15 ou une version plus récente ;
- Visual Studio Code 1.101 ou plus récent est installé ;
- environ 2 Go d'espace disque sont disponibles ;
- tu disposes d'une connexion Internet pendant l'installation.

Pour vérifier la puce et la version de macOS, ouvre le menu ** → À propos de ce
Mac**.

> oMLX ne fonctionne pas sur les Mac Intel ou sur Windows. Dans ce cas, OneAgent
> reste utilisable avec la recherche par mots-clés, mais les recherches
> sémantiques locales ne seront pas disponibles.

## Étape 1 — Installer OneAgent dans Visual Studio Code

### Télécharger l'extension

1. Ouvre la page de la
   [dernière version de OneAgent](https://github.com/ValentinDeSmet/OneAgent-release/releases/latest).
2. En bas de la version, ouvre la section **Assets** si elle est repliée.
3. Télécharge le fichier dont le nom se termine uniquement par `.vsix`.

Exemple :

```text
work-memory-vscode-extension-0.1.115.vsix
```

Ne télécharge pas le fichier qui se termine par `.sha256` : il sert uniquement
au contrôle de sécurité automatique.

### Installer le fichier

1. Ouvre **Visual Studio Code**.
2. Clique sur l'icône **Extensions** dans la barre verticale de gauche.
3. Clique sur le bouton **…** en haut de la vue Extensions.
4. Choisis **Install from VSIX…** ou **Installer à partir d'un VSIX…**.
5. Sélectionne le fichier `.vsix` téléchargé.
6. Attends le message confirmant l'installation.
7. Clique sur **Reload** ou **Recharger** si Visual Studio Code le propose.

Après le rechargement, **OneAgent** doit apparaître dans la liste des extensions
installées et dans la barre d'activité de Visual Studio Code.

## Étape 2 — Installer oMLX

oMLX doit rester actif pendant l'utilisation de OneAgent. Il fonctionne en
arrière-plan depuis la barre de menus du Mac.

1. Ouvre les [versions officielles de oMLX](https://github.com/jundot/omlx/releases).
2. Ouvre la dernière version stable.
3. Dans **Assets**, télécharge le fichier `.dmg`.
4. Ouvre le fichier téléchargé.
5. Fais glisser **oMLX** dans le dossier **Applications**.
6. Ouvre le dossier Applications, puis lance **oMLX**.

Si macOS bloque le premier lancement :

1. ouvre **Réglages Système → Confidentialité et sécurité** ;
2. repère le message concernant oMLX ;
3. clique sur **Ouvrir quand même** ;
4. confirme le lancement.

Au premier démarrage, l'assistant oMLX demande où conserver les modèles. Tu peux
garder le dossier proposé par défaut :

```text
~/.omlx/models
```

Clique ensuite sur **Start Server** ou **Démarrer le serveur**. L'état du serveur
doit devenir **Running**, **Started** ou apparaître en vert.

Le tableau de bord oMLX est accessible depuis son menu avec **Open Dashboard**,
ou directement à cette adresse :
[http://127.0.0.1:8000/admin](http://127.0.0.1:8000/admin).

## Étape 3 — Télécharger le modèle local BGE-M3

Le nom exact du modèle recommandé par OneAgent est :

```text
mlx-community/bge-m3-mlx-fp16
```

1. Dans le tableau de bord oMLX, ouvre **Models**, **Browse Models** ou
   **Parcourir les modèles**.
2. Dans la zone de recherche, colle :

   ```text
   mlx-community/bge-m3-mlx-fp16
   ```

3. Sélectionne bien la variante **fp16**. N'utilise pas les variantes `4bit`,
   `6bit` ou `8bit` pour cette première installation.
4. Clique sur **Download** ou **Télécharger**.
5. Attends la fin complète du téléchargement. Le modèle occupe environ 1,1 Go ;
   cette étape peut prendre plusieurs minutes.
6. Vérifie que le modèle apparaît maintenant dans la liste des modèles
   installés.

oMLX doit reconnaître BGE-M3 comme un modèle de type **Embedding**. S'il
n'apparaît pas immédiatement, arrête puis redémarre le serveur depuis le menu
oMLX.

Tu peux vérifier le nom et les informations du modèle sur sa
[page Hugging Face](https://huggingface.co/mlx-community/bge-m3-mlx-fp16).

## Étape 4 — Premier lancement de OneAgent

1. Reviens dans Visual Studio Code.
2. Ouvre le dossier dans lequel tu souhaites utiliser OneAgent avec
   **File → Open Folder…** ou **Fichier → Ouvrir le dossier…**.
3. Clique sur l'icône **OneAgent** dans la barre verticale de gauche.
4. Ouvre la page **Settings** de OneAgent.
5. Dans les actions **Runtime**, clique sur **Diagnose**.

L'installation est réussie lorsque la section Runtime indique :

- le fournisseur `omlx` ;
- le modèle `bge-m3-mlx-fp16` ;
- un état disponible, `ok` ou affiché en vert.

Lors du premier lancement, OneAgent crée automatiquement un dossier caché
`.work-memory` dans le dossier de travail. Aucune configuration manuelle n'est
nécessaire.

## Utilisation quotidienne

Avant d'utiliser la recherche intelligente de OneAgent :

1. vérifie que oMLX est lancé dans la barre de menus du Mac ;
2. vérifie que son serveur est démarré ;
3. ouvre ensuite Visual Studio Code et ton dossier de travail.

Le modèle BGE-M3 est chargé automatiquement lorsqu'une recherche ou une
indexation en a besoin.

## Mettre OneAgent à jour

OneAgent recherche automatiquement une nouvelle version stable une fois par
jour. Le fichier téléchargé est vérifié avant d'être installé.

Pour lancer la vérification immédiatement :

1. ouvre **OneAgent → Settings** ;
2. clique sur **Check for updates** ;
3. attends la fin du téléchargement et de l'installation ;
4. clique sur **Reload Window** lorsque OneAgent le propose.

Après le rechargement, la nouvelle version est visible dans la carte
**Version** des Settings.

## Résoudre les problèmes courants

### OneAgent n'apparaît pas dans Visual Studio Code

1. Ouvre la vue **Extensions**.
2. Recherche `OneAgent`.
3. Vérifie que l'extension est indiquée comme **Installed** et **Enabled**.
4. Ouvre la palette avec `Cmd + Shift + P`.
5. lance **Developer: Reload Window**.

### OneAgent affiche `Embeddings down`

1. Vérifie que l'icône oMLX est présente dans la barre de menus du Mac.
2. Ouvre oMLX et clique sur **Start Server**.
3. Vérifie que
   [http://127.0.0.1:8000/admin](http://127.0.0.1:8000/admin) s'ouvre.
4. Reviens dans **OneAgent → Settings** et clique sur **Diagnose**.

Le bouton **Start backend** affiché par OneAgent peut également démarrer oMLX.

### OneAgent affiche `Model not found`

1. Ouvre le tableau de bord oMLX.
2. Vérifie que `bge-m3-mlx-fp16` figure dans les modèles installés.
3. Vérifie que le téléchargement est entièrement terminé.
4. Redémarre le serveur oMLX.
5. Relance **Diagnose** dans OneAgent.

Si le modèle est présent sous un autre nom, ouvre ses réglages dans oMLX et
définis l'alias :

```text
bge-m3-mlx-fp16
```

### Certaines sources n'ont pas d'embedding

Cela peut arriver si des documents ont été ajoutés pendant que oMLX était
arrêté.

1. Démarre oMLX.
2. Ouvre les diagnostics OneAgent.
3. Clique sur **Embed missing**.
4. Laisse Visual Studio Code et oMLX ouverts jusqu'à la fin de l'opération.

Les documents n'ont pas besoin d'être réimportés.

### Le problème persiste

Dans Visual Studio Code :

1. ouvre **View → Output** ou **Affichage → Sortie** ;
2. choisis **OneAgent** dans la liste à droite du panneau ;
3. copie le dernier message d'erreur pour le transmettre au support.

## Installation avancée en ligne de commande

Cette section n'est pas nécessaire pour l'installation normale.

<details>
<summary>Afficher les commandes avancées</summary>

Installer et démarrer oMLX avec Homebrew :

```bash
brew tap jundot/omlx https://github.com/jundot/omlx
brew install omlx
omlx start
```

Télécharger le modèle avec le client Hugging Face :

```bash
brew install hf
hf download mlx-community/bge-m3-mlx-fp16 \
  --local-dir ~/.omlx/models/mlx-community/bge-m3-mlx-fp16
omlx restart
```

Vérifier le serveur et le modèle :

```bash
curl http://127.0.0.1:8000/v1/models
```

Tester la création d'un embedding :

```bash
curl http://127.0.0.1:8000/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"bge-m3-mlx-fp16","input":"Test OneAgent"}'
```

Si l'authentification API est activée dans oMLX, OneAgent lit automatiquement la
clé dans `~/.omlx/settings.json`. La variable d'environnement `OMLX_API_KEY`
peut également être utilisée.

</details>

## Confidentialité

OneAgent est local-first. Les dossiers de travail, captures, index SQLite et
embeddings restent sur le Mac, sauf si un service externe est configuré
explicitement.

## Licence

OneAgent est un logiciel propriétaire. Son utilisation, sa redistribution et sa
modification nécessitent l'accord du détenteur des droits.
