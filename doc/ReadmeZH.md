# Obsidian EagleBridge

这是一个用于 Obsidian 的示例插件，主要用于连接 Obsidian 与 Eagle 软件。

[eagle](https://eagle.cool) 是一款强大的附件管理软件，可以轻松管理大量图片、视频、音频素材，满足“收藏、整理、查找”的各类场景需求，支持 Windows 系统。

## 功能概述

本插件的功能包括：

- 在 Obsidian 中快速跳转 eagle 附件
- 标签同步
- 文件查看
- 附件管理

## 初次使用配置说明

1. **配置监听端口号**：需要设置一个 1000 到 9999 之间的四位复杂数值（例如 6060），以避免与常用端口号重复。为了保持附件链接的稳定性，该数值一旦设置好后，不建议进行修改。

2. **设置 Eagle 仓库位置**：通过 Eagle 软件的左上角选择仓库，并复制其路径，例如：`D:\onedrive\eagle\仓库.Library`。

完成这些操作后您需要重启obsidian，然后就可以开始使用该插件了。

## 示例展示

### 从 Eagle 中加载附件

<img src="../assets/fromeagle.gif" width="800">

### 从本地文件上传附件至 Eagle，并在 Obsidian 中查看

<img src="../assets/upload.gif" width="800">


## 安装指南

### 通过 BRAT 安装

将 `https://github.com/zyjGraphein/Obsidian-EagleBridge` 添加到 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。

### 手动安装

访问最新发布页面，下载 `main.js`、`manifest.json`、`style.css`，然后将它们放入 `<your_vault>/.obsidian/plugins/EagleBridge/`。


## 使用指南

- 文字教程（[中文](../doc/TutorialZH.md) / [EN](../doc/Tutorial.md)）
- 视频教程（[中文](https://www.bilibili.com)）

### 注意事项
- 在使用该插件时，需要 eagle 在后台保持运行，并且打开状态是对应填写路径的仓库。
- 如果 eagle 没有运行，或不处于目标路径的仓库。依旧能够查看图片，但右键的功能菜单，以及附件上传eagle会无法上传。
- 笔记导出为 pdf，图片能够正常显示，但其他的链接（url, pdf, mp4）依旧能够正常点击打开，但分享给其他人（脱离本地）会无法打开。

## 开发指南

此插件遵循 [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) 的结构，更多详情请参阅。

- 克隆此仓库
- 确保你的 NodeJS 版本至少为 v16 (`node --version`)
- 运行 `npm i` 或 `yarn` 安装依赖
- 运行 `npm run dev` 启动编译并进入观察模式

## 待办事项

- [ ] 支持多种格式文件的嵌入预览（如 PDF，MP4，PSD，OBJ 等）
- [ ] 支持 macOS 系统
- [ ] 导出时，替换所有附件的链接，并导出所有附件在一个文件夹中。


## 已知限制

为防止误删附件，删除源文件时遍历所有文件的引用目前没有好的方法。建议在 Eagle 内部删除并检索 ID 对 `.md` 文档中的链接进行删除。


## 问题或建议

欢迎提交 issue：

- Bug 反馈
- 新功能的想法
- 现有功能的优化

如果你计划实现一个大型功能，请提前与我联系，我们可以确认它是否适合此插件。


## 鸣谢

该插件的右键功能及图片放大参考了 [AttachFlow](https://github.com/Yaozhuwa/AttachFlow)，并受到 [obsidian-auto-link-title](https://github.com/zolrath/obsidian-auto-link-title)，[obsidian-image-auto-upload-plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin) 一些功能的启发。

以及感谢来自 Obsidian 论坛回答 ([get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside](https://forum.obsidian.md/t/how-to-get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside/96437)) 的帮助，实现了通过复制或拖拽获得文件来源的功能。

该插件还基于 [eagle](https://api.eagle.cool) 的 API 调用，实现 Eagle 的查看、编辑、上传功能。


## 许可证

该项目依据 [GNU 通用公共许可证 v3 (GPL-3.0)](https://github.com/zyjGraphein/EagleBridge/blob/master/LICENSE) 授权。


## 支持

如果你喜欢这个插件并想表示感谢，可以请我喝杯咖啡！

<img src="../assets/coffee.png" width="400">