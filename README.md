# OneAgent Installation Guide

This guide is intended for everyone. No technical knowledge is required—just
follow the steps in order.

## What you will install

OneAgent uses three components:

1. **OneAgent**, the extension displayed inside Visual Studio Code;
2. **oMLX**, a small application that runs intelligent searches directly on
   your Mac;
3. **BGE-M3**, the local model used by oMLX to understand the meaning of text.

Everything runs locally. Your documents, OneAgent database, and embeddings are
not sent over the Internet.

## Before you begin

Check that:

- you are using a Mac with an Apple M1, M2, M3, M4, or newer chip;
- your Mac is running macOS 15 or later;
- Visual Studio Code 1.101 or later is installed;
- you have approximately 2 GB of free disk space;
- you have an Internet connection during installation.

To check your chip and macOS version, open ** → About This Mac**.

> oMLX does not run on Intel Macs or Windows. OneAgent can still work with
> keyword search on those systems, but local semantic search will not be
> available.

## Step 1 — Install OneAgent in Visual Studio Code

### Download the extension

1. Open the
   [latest OneAgent release](https://github.com/ValentinDeSmet/OneAgent-release/releases/latest).
2. At the bottom of the release, expand **Assets** if it is collapsed.
3. Download the file whose name ends with `.vsix`.

Example:

```text
work-memory-vscode-extension-0.1.115.vsix
```

Do not download the file ending in `.sha256`. It is only used for the automatic
security check.

### Install the file

1. Open **Visual Studio Code**.
2. Click the **Extensions** icon in the left-hand activity bar.
3. Click the **…** button at the top of the Extensions view.
4. Select **Install from VSIX…**.
5. Select the `.vsix` file you downloaded.
6. Wait for the installation confirmation.
7. Click **Reload** if Visual Studio Code asks you to reload.

After reloading, **OneAgent** should appear in the list of installed extensions
and in the Visual Studio Code activity bar.

## Step 2 — Install oMLX

oMLX must be running while you use OneAgent. It works in the background from
your Mac menu bar.

1. Open the [official oMLX releases](https://github.com/jundot/omlx/releases).
2. Open the latest stable release.
3. Under **Assets**, download the `.dmg` file.
4. Open the downloaded file.
5. Drag **oMLX** into the **Applications** folder.
6. Open Applications, then launch **oMLX**.

If macOS blocks oMLX the first time you open it:

1. open **System Settings → Privacy & Security**;
2. find the message about oMLX;
3. click **Open Anyway**;
4. confirm that you want to open it.

The oMLX welcome screen asks where your models should be stored. You can keep
the suggested default folder:

```text
~/.omlx/models
```

Next, click **Start Server**. The server status should change to **Running**,
**Started**, or appear in green.

You can open the oMLX dashboard from its menu by clicking **Open Dashboard**, or
open it directly at
[http://127.0.0.1:8000/admin](http://127.0.0.1:8000/admin).

## Step 3 — Download the local BGE-M3 model

The exact model recommended by OneAgent is:

```text
mlx-community/bge-m3-mlx-fp16
```

1. In the oMLX dashboard, open **Models** or **Browse Models**.
2. Paste the following name into the search box:

   ```text
   mlx-community/bge-m3-mlx-fp16
   ```

3. Select the **fp16** version. Do not use the `4bit`, `6bit`, or `8bit`
   versions for this initial installation.
4. Click **Download**.
5. Wait until the download is fully complete. The model uses approximately
   1.1 GB, so this may take several minutes.
6. Check that the model now appears in your list of installed models.

oMLX should identify BGE-M3 as an **Embedding** model. If it does not appear
immediately, stop and restart the server from the oMLX menu.

You can confirm the model name and details on its
[Hugging Face page](https://huggingface.co/mlx-community/bge-m3-mlx-fp16).

## Step 4 — Start OneAgent for the first time

1. Return to Visual Studio Code.
2. Open the folder where you want to use OneAgent with
   **File → Open Folder…**.
3. Click the **OneAgent** icon in the left-hand activity bar.
4. Open the OneAgent **Settings** page.
5. Under the **Runtime** actions, click **Diagnose**.

The installation is working when the Runtime section shows:

- the `omlx` provider;
- the `bge-m3-mlx-fp16` model;
- an available, `ok`, or green status.

When you open OneAgent for the first time, it automatically creates a hidden
`.work-memory` folder inside your workspace. No manual configuration is
required.

## Everyday use

Before using OneAgent's intelligent search:

1. check that oMLX is visible in your Mac menu bar;
2. check that its server is running;
3. then open Visual Studio Code and your workspace.

The BGE-M3 model is loaded automatically when a search or indexing operation
needs it.

## Update OneAgent

OneAgent automatically checks for a new stable version once a day. The
downloaded file is verified before it is installed.

To check immediately:

1. open **OneAgent → Settings**;
2. click **Check for updates**;
3. wait for the download and installation to finish;
4. click **Reload Window** when OneAgent asks you to reload.

After reloading, the new version is displayed in the **Version** card in
Settings.

## Fix common problems

### OneAgent does not appear in Visual Studio Code

1. Open the **Extensions** view.
2. Search for `OneAgent`.
3. Check that the extension is marked as **Installed** and **Enabled**.
4. Open the Command Palette with `Cmd + Shift + P`.
5. Run **Developer: Reload Window**.

### OneAgent displays `Embeddings down`

1. Check that the oMLX icon is visible in your Mac menu bar.
2. Open oMLX and click **Start Server**.
3. Check that
   [http://127.0.0.1:8000/admin](http://127.0.0.1:8000/admin) opens.
4. Return to **OneAgent → Settings** and click **Diagnose**.

You can also use the **Start backend** button displayed by OneAgent to start
oMLX.

### OneAgent displays `Model not found`

1. Open the oMLX dashboard.
2. Check that `bge-m3-mlx-fp16` appears in the installed models.
3. Check that the download is fully complete.
4. Restart the oMLX server.
5. Run **Diagnose** again in OneAgent.

If the model is installed under a different name, open its settings in oMLX and
set this alias:

```text
bge-m3-mlx-fp16
```

### Some sources do not have embeddings

This can happen if documents were added while oMLX was not running.

1. Start oMLX.
2. Open the OneAgent diagnostics.
3. Click **Embed missing**.
4. Keep Visual Studio Code and oMLX open until the operation finishes.

You do not need to import the documents again.

### The problem continues

In Visual Studio Code:

1. open **View → Output**;
2. select **OneAgent** from the list on the right side of the panel;
3. copy the latest error message and send it to your support contact.

## Advanced command-line installation

This section is not required for the normal installation.

<details>
<summary>Show advanced commands</summary>

Install and start oMLX with Homebrew:

```bash
brew tap jundot/omlx https://github.com/jundot/omlx
brew install omlx
omlx start
```

Download the model with the Hugging Face client:

```bash
brew install hf
hf download mlx-community/bge-m3-mlx-fp16 \
  --local-dir ~/.omlx/models/mlx-community/bge-m3-mlx-fp16
omlx restart
```

Check the server and model:

```bash
curl http://127.0.0.1:8000/v1/models
```

Test embedding generation:

```bash
curl http://127.0.0.1:8000/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"bge-m3-mlx-fp16","input":"OneAgent test"}'
```

If API authentication is enabled in oMLX, OneAgent automatically reads the key
from `~/.omlx/settings.json`. You can also use the `OMLX_API_KEY` environment
variable.

</details>

## Privacy

OneAgent is local-first. Your workspaces, captures, SQLite indexes, and
embeddings stay on your Mac unless you explicitly configure an external
service.

## License

OneAgent is proprietary software. Its use, redistribution, and modification
require permission from the copyright holder.
