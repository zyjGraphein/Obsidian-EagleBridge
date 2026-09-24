<p align="center">
  <img src="./logo/OEbridge.svg" alt="EagleBridge logo" width="120" height="120">
</p>

# Obsidian EagleBridge

【[中文](./doc/ReadmeZH.md) / EN】

EagleBridge connects Obsidian notes and Canvas boards with media managed in Eagle.

[eagle](https://eagle.cool) is a powerful attachment management software that allows for easy management of large quantities of images, videos, and audio materials, suitable for various scenarios such as collection, organization, and search. EagleBridge is intended for desktop vaults on Windows and macOS.

## Features Overview

This plugin includes the following functionalities:

- Drag or paste Eagle media into Markdown notes and Canvas boards, with embedded previews.
- Connect up to 5 Eagle libraries, configure device-specific paths, and choose upload destinations and file types.
- Inspect attachment references across the current vault, edit metadata, and choose which links to remove.
- Batch-migrate the current note's local attachments, including videos, to Eagle; export Markdown with Eagle attachments as a folder or ZIP.
- Choose tag-sync direction and send note backlinks to Eagle with the companion Eagle plugin.
- Copy embeds, Markdown links, plain URLs or item IDs from Eagle, using the active preview port for each library.
- Integrate with obEcraft, with improved macOS paths, iCloud imports, video editing, and settings UI.
- Share preview listeners across open Obsidian vaults using the same Eagle library and port, with automatic takeover after the serving window closes.

See the [0.3.5 feature summary and video outline (Chinese)](./RELEASE_NOTES_0.3.5.md) for the full update and feature limits.

[![GitHub stars](https://img.shields.io/github/stars/zyjGraphein/Obsidian-EagleBridge?style=flat&label=Stars)](https://github.com/zyjGraphein/Obsidian-EagleBridge/stargazers)
[![Total Downloads](https://img.shields.io/github/downloads/zyjGraphein/Obsidian-EagleBridge/total?style=flat&label=Total%20Downloads)](https://github.com/zyjGraphein/Obsidian-EagleBridge/releases)
[![GitHub Release](https://img.shields.io/github/v/release/zyjGraphein/Obsidian-EagleBridge?style=flat&label=Release)](https://github.com/zyjGraphein/Obsidian-EagleBridge/releases/latest)
![GitHub Downloads (specific asset, all releases)|150](https://img.shields.io/github/downloads/zyjGraphein/Obsidian-EagleBridge/main.js) 
![GitHub Downloads (specific asset, latest release)](https://img.shields.io/github/downloads/zyjGraphein/Obsidian-EagleBridge/latest/main.js)
[![GitHub License](https://img.shields.io/github/license/zyjGraphein/Obsidian-EagleBridge?style=flat&label=License)](https://github.com/zyjGraphein/Obsidian-EagleBridge/blob/master/LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/zyjGraphein/Obsidian-EagleBridge?style=flat&label=Issues)](https://github.com/zyjGraphein/Obsidian-EagleBridge/issues)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/zyjGraphein/Obsidian-EagleBridge?style=flat&label=Last%20Commit)](https://github.com/zyjGraphein/Obsidian-EagleBridge/commits/master)

## Initial Setup Instructions

1. **Add an Eagle library** in EagleBridge settings. Give it an alias and a stable preview port (1000–65535, e.g. 6060). Different Eagle libraries need different ports. When several Obsidian vaults use the same library, configure the same port in each to share the preview service.

2. **Set the library path**, copied from Eagle's library selector. Examples:
   Windows: `D:\onedrive\eagle\Library.library`
   macOS: `/Users/you/Pictures/Eagle/Library.library`

3. **Configure other devices or libraries**: Add alternate device paths within the same library profile; the first accessible path is used. Add a separate profile for each different Eagle library, up to 5.

4. **Choose upload behavior**: Select a default Eagle library or ask on each upload. Markdown, Canvas, and file-type switches can be configured separately. Library changes refresh preview services automatically.

Update and reload EagleBridge in all open Obsidian vaults to use shared previews. Keep established ports stable because saved links contain the port number.


## Showcase

### Load Attachments from Eagle

<img src="assets/fromeagle.gif" width="800">

### Upload Local Attachments to Eagle via EagleBridge and View in Obsidian

<img src="assets/upload.gif" width="800">


## Installation Instructions

### Install via BRAT

Add `https://github.com/zyjGraphein/Obsidian-EagleBridge` to [BRAT](https://github.com/TfTHacker/obsidian42-brat).

### Manual Installation

Visit the latest release page, download `main.js`, `manifest.json`, and `styles.css`, then place them into `<your_vault>/.obsidian/plugins/EagleBridge/`.


## Usage Guide

- Text Tutorial ([中文](./doc/TutorialZH.md) / [EN](./doc/Tutorial.md))
- Video Tutorial ([Obsidian EagleBridge -bilibili](https://www.bilibili.com/video/BV1voQsYaE5W/?share_source=copy_web&vd_source=491bedf306ddb53a3baa114332c02b93))


### Notes
- File uploads require Eagle 4 or later. EagleBridge uses the item IDs returned by Eagle to insert links; it does not watch or scan the entire library for new files. iCloud and external-drive libraries still need to be accessible locally for previews.
- If an Eagle file comes from a library that is not configured, add that library as a separate library profile before dragging it into Obsidian. EagleBridge will not re-import it into another library.
- Eagle must be running for uploads and operations that use its API; EagleBridge switches to the configured target library when required. Local previews and reference browsing can still work while Eagle is closed, provided the library files are accessible.
- When exporting notes as a PDF, images will display correctly, but other links (URLs, PDFs, MP4s) will still be clickable. However, when shared with others (outside the local environment), these links may not open.

### Batch attachment migration

Run **EagleBridge: Upload current Markdown attachments to Eagle** on the current note, or assign a hotkey in **Settings → Hotkeys**. This includes videos and other local attachments referenced in the Markdown body. Imports run sequentially using local file paths; video contents are not buffered in Obsidian's JavaScript memory.

Successful references are replaced even if another import fails. Original attachments go to trash only after checking the Eagle copy and remaining references. YAML data is preserved; paths inside YAML and migration across multiple notes are not supported. Third-party card thumbnails depend on the card plugin.

Embedded videos start paused in Live Preview and Reading view. Select the play control to start playback. Embeds with empty alt text also detect videos. In Live Preview, use the code button at the top right to edit the embed link.

### Copy links from Eagle

Install or update the complete `eagle_to_ob` folder as an Eagle plugin, and reload EagleBridge in Obsidian. In Eagle's inspector, select the **logo** to open **Copy link**. Choose **Embed**, **Link**, **URL** or **Item ID** (plain `ID.info`, without Markdown or a URL); embed width defaults to 700 px and can be changed or left blank. Use the separate **+** button to add a backlink.

Copying a URL or Markdown link requires Obsidian to be running with EagleBridge enabled and the selected item's library configured. The panel discovers that library's live preview service and checks it again before copying; it does not assume port 6060. If the same library has several preview addresses, select one. If unavailable, start/reload EagleBridge and select **Retry**. Existing clipboard contents are preserved on a failed service check. A plain item ID can be copied even when the preview service is offline. A working preview from an older plugin is not enough for discovery: update and reload EagleBridge in every open Obsidian vault, including the window currently serving that port.

Discovery uses small local records under `~/.eaglebridge/preview-servers` in your user home folder, containing only ports and temporary service IDs, grouped by a hash of library identity. It does not upload data or scan network ports. These localhost links work on the local device while its preview service is running.

## Development Guide

This plugin follows the structure of the [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin). More details can be found there.

- Clone this repository
- Ensure your NodeJS is at least v16 (`node --version`)
- Run `npm i` or `yarn` to install dependencies
- Run `npm run dev` to start the compiler in watch mode


## To-Do List

- [x] Support embedded previews for various file formats (e.g., PDF, MP4, PSD, OBJ, etc.)
- [ ] Support updating position when dragging.
- [x] Export a Markdown note with its resolvable Eagle attachments to a folder or ZIP.

## Known Limitations

Reference and deletion checks cover the current Obsidian vault, not other open vaults or external applications. Shared preview services do not merge reference indexes. Batch migration is limited to the current Markdown body, and media playback depends on formats supported by Obsidian. Backlinks generated for Eagle require Advanced URI, a configured vault identifier, and a YAML `id` on the note. The companion Eagle inspector supports common images, videos (including MP4), audio, PDF, web bookmarks (URL), design files, fonts, 3D assets, documents and archives. Its logo opens link copying; existing backlinks and the add button appear alongside it.


## Issues and Suggestions

You are welcome to submit issues for:

- Bug reports
- Ideas for new features
- Optimizations for existing features

If you are considering developing a large feature, please contact me first so we can determine if it is a good fit for this plugin.


## Credits
This plugin also utilizes API calls from [eagle](https://api.eagle.cool/) to enable viewing, editing, and uploading of Eagle content.

The right-click functionality and image zooming in this plugin draw inspiration from [AttachFlow](https://github.com/Yaozhuwa/AttachFlow)

Video and PDF external link embedding previews are inspired by the corresponding features of [auto-embed](https://github.com/GnoxNahte/obsidian-auto-embed).

Additionally, it is also inspired by some features from[PicGo+Eagle+Python](https://zhuanlan.zhihu.com/p/695526765), [obsidian-auto-link-title](https://github.com/zolrath/obsidian-auto-link-title) and [obsidian-image-auto-upload-plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin). 

Additionally, support from the Obsidian forum ([get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside](https://forum.obsidian.md/t/how-to-get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside/96437)) helped in implementing the ability to capture file sources via copying or dragging.


## License

This project is licensed under the [GNU General Public License v3 (GPL-3.0)](https://github.com/zyjGraphein/EagleBridge/blob/master/LICENSE).


## Support

If you appreciate this plugin and want to say thanks, you can buy me a coffee!

<img src="assets/coffee.png" width="400">
