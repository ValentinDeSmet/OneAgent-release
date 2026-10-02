# Updates and what's new

OneAgent checks the public stable release channel automatically about once every 24 hours while Visual Studio Code is running, or at the next startup.

## Check manually

1. Open **OneAgent → Settings**.
2. In the **Version** card, select **Check for updates**.
3. Wait while OneAgent downloads and verifies the VSIX.
4. Select **Reload Window** when Visual Studio Code asks.
5. Return to Settings and confirm the new version number.

You can also run **OneAgent: Check for Updates** from the Command Palette.

## What happens during an update

OneAgent:

1. checks the dedicated public release repository;
2. downloads only a newer stable VSIX;
3. verifies its published SHA-256 checksum;
4. asks Visual Studio Code to install it;
5. asks you to reload before using the new version.

Your workspace memory is not replaced by the VSIX. OneAgent upgrades its local data structures when required while preserving supported history.

## Find what changed

Read the [extension changelog](../CHANGELOG.md) for the changes included in each version. The [public OneAgent release page](https://github.com/ValentinDeSmet/OneAgent-release/releases) also shows the published stable packages.

Check the installed version in **OneAgent → Settings → Version** before comparing it with release notes.

## If no update is found

You already have the latest stable version, or the release check could not reach GitHub. Open **OneAgent Output** if the message reports an error.

Automatic checks can be disabled in Visual Studio Code settings with **OneAgent: Automatic Updates**. You can still use **Check for updates** manually.

For installation errors and manual recovery, see [Troubleshooting](troubleshooting.md).
