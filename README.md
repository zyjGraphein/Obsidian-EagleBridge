# Obsidian EagleBridge
<div align="center">

![GitHub Downloads (specific asset, all releases)|150](https://img.shields.io/github/downloads/zyjGraphein/EagleBridge/main.js) ![GitHub Downloads (specific asset, latest release)](https://img.shields.io/github/downloads/zyjGraphein/EagleBridge/latest/main.js)



<!-- [![GitHub stars](https://img.shields.io/github/stars/RavenHogWarts/obsidian-ravenhogwarts-toolkit?style=flat&label=Stars)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/stargazers)
[![Total Downloads](https://img.shields.io/github/downloads/RavenHogWarts/obsidian-ravenhogwarts-toolkit/total?style=flat&label=Total%20Downloads)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/releases)
[![Latest Release Downloads](https://img.shields.io/github/downloads/RavenHogWarts/obsidian-ravenhogwarts-toolkit/latest/total?style=flat&label=Latest%20Release%20Downloads)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/releases/latest)
[![Latest Pre-release Downloads](https://img.shields.io/github/downloads-pre/RavenHogWarts/obsidian-ravenhogwarts-toolkit/latest/total?style=flat&label=Latest%20Beta%20Downloads)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/releases)
[![GitHub Release](https://img.shields.io/github/v/release/RavenHogWarts/obsidian-ravenhogwarts-toolkit?style=flat&label=Release)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/releases/latest)
[![GitHub Release (Beta)](https://img.shields.io/github/v/release/RavenHogWarts/obsidian-ravenhogwarts-toolkit?include_prereleases&style=flat&label=Beta)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/releases)
[![GitHub License](https://img.shields.io/github/license/RavenHogWarts/obsidian-ravenhogwarts-toolkit?style=flat&label=License)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/blob/master/LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/RavenHogWarts/obsidian-ravenhogwarts-toolkit?style=flat&label=Issues)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/issues)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/RavenHogWarts/obsidian-ravenhogwarts-toolkit?style=flat&label=Last%20Commit)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/commits/master) -->

【[中文](./ZH.md) / EN】
</div>
This is a sample plugin for Obsidian (https://obsidian.md).

This project uses TypeScript to provide type checking and documentation.
The repo depends on the latest plugin API (obsidian.d.ts) in TypeScript Definition format, which contains TSDoc comments describing what it does.

This sample plugin demonstrates some of the basic functionality the plugin API can do.
- Adds a ribbon icon, which shows a Notice when clicked.
- Adds a command "Open Sample Modal" which opens a Modal.
- Adds a plugin setting tab to the settings page.
- Registers a global click event and output 'click' to the console.
- Registers a global interval which logs 'setInterval' to the console.

## First time developing plugins?

Quick starting guide for new plugin devs:

- Check if [someone already developed a plugin for what you want](https://obsidian.md/plugins)! There might be an existing plugin similar enough that you can partner up with.
- Make a copy of this repo as a template with the "Use this template" button (login to GitHub if you don't see it).
- Clone your repo to a local development folder. For convenience, you can place this folder in your `.obsidian/plugins/your-plugin-name` folder.
- Install NodeJS, then run `npm i` in the command line under your repo folder.
- Run `npm run dev` to compile your plugin from `main.ts` to `main.js`.
- Make changes to `main.ts` (or create new `.ts` files). Those changes should be automatically compiled into `main.js`.
- Reload Obsidian to load the new version of your plugin.
- Enable plugin in settings window.
- For updates to the Obsidian API run `npm update` in the command line under your repo folder.

## Releasing new releases

- Update your `manifest.json` with your new version number, such as `1.0.1`, and the minimum Obsidian version required for your latest release.
- Update your `versions.json` file with `"new-plugin-version": "minimum-obsidian-version"` so older versions of Obsidian can download an older version of your plugin that's compatible.
- Create new GitHub release using your new version number as the "Tag version". Use the exact version number, don't include a prefix `v`. See here for an example: https://github.com/obsidianmd/obsidian-sample-plugin/releases
- Upload the files `manifest.json`, `main.js`, `styles.css` as binary attachments. Note: The manifest.json file must be in two places, first the root path of your repository and also in the release.
- Publish the release.

> You can simplify the version bump process by running `npm version patch`, `npm version minor` or `npm version major` after updating `minAppVersion` manually in `manifest.json`.
> The command will bump version in `manifest.json` and `package.json`, and add the entry for the new version to `versions.json`

## Adding your plugin to the community plugin list

- Check the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- Publish an initial version.
- Make sure you have a `README.md` file in the root of your repo.
- Make a pull request at https://github.com/obsidianmd/obsidian-releases to add your plugin.

## How to use

- Clone this repo.
- Make sure your NodeJS is at least v16 (`node --version`).
- `npm i` or `yarn` to install dependencies.
- `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## Improve code quality with eslint (optional)
- [ESLint](https://eslint.org/) is a tool that analyzes your code to quickly find problems. You can run ESLint against your plugin to find common bugs and ways to improve your code. 
- To use eslint with this project, make sure to install eslint from terminal:
  - `npm install -g eslint`
- To use eslint to analyze this project use this command:
  - `eslint main.ts`
  - eslint will then create a report with suggestions for code improvement by file and line number.
- If your source code is in a folder, such as `src`, you can use eslint with this command to analyze all files in that folder:
  - `eslint .\src\`

## Funding URL

You can include funding URLs where people who use your plugin can financially support it.

The simple way is to set the `fundingUrl` field to your link in your `manifest.json` file:

```json
{
    "fundingUrl": "https://buymeacoffee.com"
}
```

If you have multiple URLs, you can also do:

```json
{
    "fundingUrl": {
        "Buy Me a Coffee": "https://buymeacoffee.com",
        "GitHub Sponsor": "https://github.com/sponsors",
        "Patreon": "https://www.patreon.com/"
    }
}
```

## Support
If you like this plugin and want to say thanks, you can buy me a coffee here!
<img src="assets/coffee.png" width="400">

