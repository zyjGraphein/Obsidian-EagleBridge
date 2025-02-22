# Obsidian EagleBridge
<div align="center">
【[中文](./doc/ReadmeZH.md) / EN】
</div>
This is a sample plugin for Obsidian，主要用于 obsidian 与 eagle 软件的链接。
Eagle 是一款附件管理软件。Eagle 可以轻松管理大量图片、视频、音频素材,满足素材「收藏、整理、查找」的各种场景,支持  Windows 系统。
本插件功能包含如下
- 实现包括在 obsidian 中快速跳转附件，标签同步，文件查看，附件管理等操作。
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

第一次使用，首先需要配置好监听端口号，由 4 位数值范围是从 1000到 9999，尽可能是一个复杂的数值例如 6060。避免与常用端口号重复。且该数值一旦设置好，为保持附件链接的稳定性，不建议日后进行修改。
其次，此外还需要设置好 eagle 仓库所在的位置，需要在 eagle 软件中的左上角选择仓库，复制路径例如：D:\onedrive\eagle\仓库. Library。
将这两项设置好后便可开始使用。

# Showcase
从eagle中加载附件
<img src="assets/fromeagle.gif" width="600">
从本地文件中的附件通过EagleBridge上传eagle，并在obsidian中查看
<img src="assets/upload.gif" width="600">
# 安装
### Install from BRAT  从 BRAT 安装
Add `https://github.com/zyjGraphein/ObsidianEagleBridge` to [BRAT](https://github.com/TfTHacker/obsidian42-brat).  
添加到 `https://github.com/zyjGraphein/ObsidianEagleBridge` [BRAT](https://github.com/TfTHacker/obsidian42-brat)中。

### Manual installation  手动安装
Go to the latest release page and download the `main.js`, `manifest.json`, `style.css`, and put them to `<your_vault>/.obsidian/plugins/EagleBridge/`.  
转到最新版本页面，下载 `main.js`、`manifest.json`、`style.css`，然后将它们放入 `<your_vault>/.obsidian/plugins/EagleBridge/` 。
# 使用指南
- 文字教程（[中文](./TutorialZH.md) / [EN](./Tutorial.md)）
- 视频教程（[中文](https://www.bilibili.com/video/BV15y4y1175y/) ）
# Development
This plugin follows the structure of the [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) plugin, please see further details there.  
此插件遵循 [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) 插件的结构，请参阅此处的更多详细信息。
- Clone this repo
- Make sure your NodeJS is at least v16 (`node --version`)
- `npm i` or `yarn` to install dependencies
- `npm run dev` to start compilation in watch mode
# TODO
- [ ] 支持嵌入式预览多种格式文件（pdf, mp4,psd,obj等）
# Known limitations  已知限制
为了防止附件被多处引用，而误删附件，删除源文件时遍历所有文件的引用目前没有找到很好的方法，建议通过 eagle 内部删除以及检索 id 对.md 文档中的链接进行删除。
# 问题或建议
欢迎大家提交 issue：
- Bug 反馈
- 对新功能的想法
- 对已有功能的优化
If you're thinking about implementing a large feature, please open an issue first or contact me , we can figure out if it's a good fit for this plugin.  
如果你正在考虑实现一个大型功能，请与我联系，我们可以弄清楚它是否适合这个插件。
# Credits
该插件的右键功能以及图片放大参考了[AttachFlow](https://github.com/Yaozhuwa/AttachFlow)，此外受到的 [obsidian-auto-link-title](https://github.com/zolrath/obsidian-auto-link-title) ，[obsidian-image-auto-upload-plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin)， 启发, 以及来自 obsidian 论坛回答([get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside](https://forum.obsidian.md/t/how-to-get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside/96437))  的帮助，实现了对通过复制或拖拽获取文件来源方式。
该插件还基于对[https://api.eagle.cool/](https://api.eagle.cool/)的api调用，实现查看，编辑，上传 eagle 的功能。
## License 许可证
This project is licensed under the [GNU General Public License v3 (GPL-3.0)](https://github.com/zyjGraphein/ObsidianEagleBridge/master/LICENSE)
## Support
If you like this plugin and want to say thanks, you can buy me a coffee here!
<img src="assets/coffee.png" width="400">

