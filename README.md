# Obsidian EagleBridge

<div align="center">
[中文](./doc/ReadmeZH.md) / EN
</div>

This is a sample plugin for Obsidian, designed to integrate Obsidian with the Eagle software.

[eagle](https://eagle.cool) is a powerful attachment management software that allows for easy management of large quantities of images, videos, and audio materials, suitable for various scenarios such as collection, organization, and search. It supports Windows systems.

## Features Overview

This plugin includes the following functionalities:

- Quick attachment navigation in Obsidian
- Tag synchronization
- File viewing
- Attachment management

![GitHub Downloads (specific asset, all releases)|150](https://img.shields.io/github/downloads/zyjGraphein/EagleBridge/main.js) 
![GitHub Downloads (specific asset, latest release)](https://img.shields.io/github/downloads/zyjGraphein/EagleBridge/latest/main.js)


## Initial Setup Instructions

1. **Configure the Listening Port**: Set a four-digit, complex value between 1000 and 9999 (e.g., 6060) to avoid conflicts with common port numbers. Once set, it is recommended not to change it to ensure stable attachment links.

2. **Set Eagle Library Location**: Select the library in the top left corner of the Eagle software and copy its path, for example: `D:\onedrive\eagle\Library`.

You can start using the plugin once these configurations are complete.


## Showcase

### Load Attachments from Eagle

<img src="assets/fromeagle.gif" width="600">

### Upload Local Attachments to Eagle via EagleBridge and View in Obsidian

<img src="assets/upload.gif" width="600">


## Installation Instructions

### Install via BRAT

Add `https://github.com/zyjGraphein/ObsidianEagleBridge` to [BRAT](https://github.com/TfTHacker/obsidian42-brat).

### Manual Installation

Visit the latest release page, download `main.js`, `manifest.json`, and `style.css`, then place them into `<your_vault>/.obsidian/plugins/EagleBridge/`.


## Usage Guide

- Text Tutorial ([中文](./doc/TutorialZH.md) / [EN](./doc/Tutorial.md))
- Video Tutorial ([中文](https://www.bilibili.com))


## Development Guide

This plugin follows the structure of the [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin). More details can be found there.

- Clone this repository
- Ensure your NodeJS is at least v16 (`node --version`)
- Run `npm i` or `yarn` to install dependencies
- Run `npm run dev` to start the compiler in watch mode


## To-Do List

- [ ] Support embedded previews for various file formats (e.g., PDF, MP4, PSD, OBJ, etc.)


## Known Limitations

Currently, there is no effective method to prevent accidental deletion of attachments when traversing all file references. It is recommended to delete within Eagle and use ID retrieval to remove links in `.md` files.


## Issues and Suggestions

You are welcome to submit issues for:

- Bug reports
- Ideas for new features
- Optimizations for existing features

If you are considering developing a large feature, please contact me first so we can determine if it is a good fit for this plugin.


## Credits

The right-click functionality and image zooming in this plugin draw inspiration from [AttachFlow](https://github.com/Yaozhuwa/AttachFlow), as well as [obsidian-auto-link-title](https://github.com/zolrath/obsidian-auto-link-title) and [obsidian-image-auto-upload-plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin). Additionally, support from the Obsidian forum ([get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside](https://forum.obsidian.md/t/how-to-get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside/96437)) helped in implementing the ability to capture file sources via copying or dragging.

This plugin also utilizes API calls from [eagle](https://api.eagle.cool/) to enable viewing, editing, and uploading of Eagle content.


## License

This project is licensed under the [GNU General Public License v3 (GPL-3.0)](https://github.com/zyjGraphein/EagleBridge/blob/master/LICENSE).


## Support

If you appreciate this plugin and want to say thanks, you can buy me a coffee!

<img src="assets/coffee.png" width="400">


<!-- [![GitHub stars](https://img.shields.io/github/stars/RavenHogWarts/obsidian-ravenhogwarts-toolkit?style=flat&label=Stars)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/stargazers)
[![Total Downloads](https://img.shields.io/github/downloads/RavenHogWarts/obsidian-ravenhogwarts-toolkit/total?style=flat&label=Total%20Downloads)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/releases)
[![Latest Release Downloads](https://img.shields.io/github/downloads/RavenHogWarts/obsidian-ravenhogwarts-toolkit/latest/total?style=flat&label=Latest%20Release%20Downloads)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/releases/latest)
[![Latest Pre-release Downloads](https://img.shields.io/github/downloads-pre/RavenHogWarts/obsidian-ravenhogwarts-toolkit/latest/total?style=flat&label=Latest%20Beta%20Downloads)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/releases)
[![GitHub Release](https://img.shields.io/github/v/release/RavenHogWarts/obsidian-ravenhogwarts-toolkit?style=flat&label=Release)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/releases/latest)
[![GitHub Release (Beta)](https://img.shields.io/github/v/release/RavenHogWarts/obsidian-ravenhogwarts-toolkit?include_prereleases&style=flat&label=Beta)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/releases)
[![GitHub License](https://img.shields.io/github/license/RavenHogWarts/obsidian-ravenhogwarts-toolkit?style=flat&label=License)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/blob/master/LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/RavenHogWarts/obsidian-ravenhogwarts-toolkit?style=flat&label=Issues)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/issues)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/RavenHogWarts/obsidian-ravenhogwarts-toolkit?style=flat&label=Last%20Commit)](https://github.com/RavenHogWarts/obsidian-ravenhogwarts-toolkit/commits/master) -->