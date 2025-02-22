# Obsidian EagleBridge

<div align="center">
【[中文](./doc/ReadmeZH.md) / EN】
</div>

这是一个用于 Obsidian 的示例插件，主要用于连接 Obsidian 与 Eagle 软件。

Eagle 是一款强大的附件管理软件，可以轻松管理大量图片、视频、音频素材，满足“收藏、整理、查找”的各类场景需求，支持 Windows 系统。

## 功能概述

本插件的功能包括：

- 在 Obsidian 中快速跳转附件
- 标签同步
- 文件查看
- 附件管理

![GitHub Downloads (specific asset, all releases)|150](https://img.shields.io/github/downloads/zyjGraphein/EagleBridge/main.js) 
![GitHub Downloads (specific asset, latest release)](https://img.shields.io/github/downloads/zyjGraphein/EagleBridge/latest/main.js)

---

## 初次使用配置说明

1. **配置监听端口号**：需要设置一个 1000 到 9999 之间的四位复杂数值（例如 6060），以避免与常用端口号重复。为了保持附件链接的稳定性，该数值一旦设置好后，不建议进行修改。

2. **设置 Eagle 仓库位置**：通过 Eagle 软件的左上角选择仓库，并复制其路径，例如：`D:\onedrive\eagle\仓库.Library`。

完成以上配置后即可开始使用。

---

## 示例展示

### 从 Eagle 中加载附件

<img src="assets/fromeagle.gif" width="600">

### 从本地文件上传附件至 Eagle，并在 Obsidian 中查看

<img src="assets/upload.gif" width="600">

---

## 安装指南

### 通过 BRAT 安装

将 `https://github.com/zyjGraphein/ObsidianEagleBridge` 添加到 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。

### 手动安装

访问最新发布页面，下载 `main.js`、`manifest.json`、`style.css`，然后将它们放入 `<your_vault>/.obsidian/plugins/EagleBridge/`。

---

## 使用指南

- 文字教程（[中文](./doc/TutorialZH.md) / [EN](./doc/Tutorial.md)）
- 视频教程（[中文](https://www.bilibili.com)）

---

## 开发指南

此插件遵循 [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) 的结构，更多详情请参阅。

- 克隆此仓库
- 确保你的 NodeJS 版本至少为 v16 (`node --version`)
- 运行 `npm i` 或 `yarn` 安装依赖
- 运行 `npm run dev` 启动编译并进入观察模式

---

## 待办事项

- [ ] 支持多种格式文件的嵌入预览（如 PDF，MP4，PSD，OBJ 等）

---

## 已知限制

为防止误删附件，删除源文件时遍历所有文件的引用目前没有好的方法。建议在 Eagle 内部删除并检索 ID 对 `.md` 文档中的链接进行删除。

---

## 问题或建议

欢迎提交 issue：

- Bug 反馈
- 新功能的想法
- 现有功能的优化

如果你计划实现一个大型功能，请提前与我联系，我们可以确认它是否适合此插件。

---

## 鸣谢

该插件的右键功能及图片放大参考了 [AttachFlow](https://github.com/Yaozhuwa/AttachFlow)，并受到 [obsidian-auto-link-title](https://github.com/zolrath/obsidian-auto-link-title)，[obsidian-image-auto-upload-plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin) 的启发，以及来自 Obsidian 论坛回答 ([get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside](https://forum.obsidian.md/t/how-to-get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside/96437)) 的帮助，实现了通过复制或拖拽获得文件来源的功能。

该插件还基于 [https://api.eagle.cool/](https://api.eagle.cool/) 的 API 调用，实现 Eagle 的查看、编辑、上传功能。

---

## 许可证

该项目依据 [GNU 通用公共许可证 v3 (GPL-3.0)](https://github.com/zyjGraphein/EagleBridge/blob/master/LICENSE) 授权。

---

## 支持

如果你喜欢这个插件并想表示感谢，可以请我喝杯咖啡！

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