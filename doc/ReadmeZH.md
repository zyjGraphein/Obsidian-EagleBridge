# Obsidian EagleBridge

这是一个用于 Obsidian 的示例插件，主要用于连接 Obsidian 与 Eagle 软件。

[eagle](https://eagle.cool) 是一款强大的附件管理软件，可以轻松管理大量图片、视频、音频素材，满足“收藏、整理、查找”的各类场景需求。EagleBridge 面向桌面端使用，当前重点支持 Windows 与 macOS。

## 功能概述

本插件的功能包括：

- 在 Obsidian 中快速跳转 eagle 附件
- 标签同步
- 文件查看
- 附件管理

## 初次使用配置说明

1. **配置监听端口号**：需要设置一个 1000 到 9999 之间的四位复杂数值（例如 6060），以避免与常用端口号重复。为了保持附件链接的稳定性，该数值一旦设置好后，不建议进行修改。

2. **设置 Eagle 仓库位置**：通过 Eagle 软件左上角选择仓库，并复制其库路径，例如：
   Windows：`D:\onedrive\eagle\仓库.Library`
   macOS：`/Users/you/Pictures/Eagle/仓库.Library`

3. **多设备时填写多个库路径**：如果同一个 Obsidian 仓库会在多台电脑间同步使用，可以在设置里填写多个 Eagle 库路径。插件会自动选择当前设备上第一个存在的路径。

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
- 视频教程（[Obsidian EagleBridge -bilibili](https://www.bilibili.com/video/BV1voQsYaE5W/?share_source=copy_web&vd_source=491bedf306ddb53a3baa114332c02b93)）

### 注意事项
- 文件上传需要 Eagle 4 或更新版本。插件直接使用 Eagle 返回的素材 ID 插入链接，不再监控或扫描整个素材库来查找新文件。iCloud 和外接硬盘中的素材仍需在本机可访问，才能显示预览。
- 从尚未配置的 Eagle 库拖入素材时，请先在设置中将该库添加为独立的素材库配置，避免重复导入到其他库。
- 在使用该插件时，需要 eagle 在后台保持运行，并且打开状态是对应填写路径的仓库。
- 如果 eagle 没有运行，或不处于目标路径的仓库。依旧能够查看图片，但右键的功能菜单，以及附件上传eagle会无法上传。
- 笔记导出为 pdf，图片能够正常显示，但其他的链接（url, pdf, mp4）依旧能够正常点击打开，但分享给其他人（脱离本地）会无法打开。

### 批量迁移当前文档附件

在目标文档运行 **EagleBridge: Upload current Markdown attachments to Eagle**，也可在 **设置 → 快捷键** 中为此命令设置快捷键。命令处理当前文档正文里的本地附件引用，支持图片、视频及其他附件，同一个附件只上传一次。

视频按本地文件路径交给 Eagle，逐个导入，不会将整个视频读入 Obsidian 的 JavaScript 内存。成功后替换正文引用；核对 Eagle 副本且没有其他 Markdown、YAML 属性或 Canvas 引用时，将源附件移入回收站。部分失败不影响成功项；副本或引用无法确认时保留源文件并说明原因。

目前不跨多个文档运行，也不替换 YAML 属性里的路径。其他 YAML 数据保持原样。正文原本使用 `![[视频.mp4]]` 时会保留内嵌形式；普通链接仍是普通链接。第三方卡片视图的缩略图支持取决于对应插件，并非迁移后一定会显示。

视频嵌入在实时预览和阅读模式中默认暂停，点击播放控件后才开始；空文件名的 `![](Eagle链接)` 也能识别视频。

在实时预览中，将鼠标移到视频上，点击右上角的代码按钮即可编辑文字链接；将光标移到其他行后恢复预览。

## 开发指南

此插件遵循 [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) 的结构，更多详情请参阅。

- 克隆此仓库
- 确保你的 NodeJS 版本至少为 v16 (`node --version`)
- 运行 `npm i` 或 `yarn` 安装依赖
- 运行 `npm run dev` 启动编译并进入观察模式

## 待办事项

- [x] 支持多种格式文件的嵌入预览（如 PDF，MP4，PSD，OBJ 等）
- [ ] 支持拖拽时更新位置
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

该插件主要基于 [eagle](https://api.eagle.cool) 的 API 调用，实现 Eagle 的查看、编辑、上传功能。

该插件的右键功能及图片放大参考了 [AttachFlow](https://github.com/Yaozhuwa/AttachFlow)对应的功能。

视频与PDF等外链嵌入式预览参考了[auto-embed](https://github.com/GnoxNahte/obsidian-auto-embed)对应的功能。

此外，受到[PicGo+Eagle+Python实现本地免费图床](https://zhuanlan.zhihu.com/p/695526765) ，[obsidian-auto-link-title](https://github.com/zolrath/obsidian-auto-link-title)，[obsidian-image-auto-upload-plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin) 一些功能的启发。

以及感谢来自 Obsidian 论坛回答 ([get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside](https://forum.obsidian.md/t/how-to-get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside/96437)) 的帮助，实现了通过复制或拖拽获得文件来源的功能。



## 许可证

该项目依据 [GNU 通用公共许可证 v3 (GPL-3.0)](https://github.com/zyjGraphein/EagleBridge/blob/master/LICENSE) 授权。


## 支持

如果你喜欢这个插件并想表示感谢，可以请我喝杯咖啡！

<img src="../assets/coffee.png" width="400">
