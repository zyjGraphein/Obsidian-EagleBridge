# obEcraft protocol

## 1. 目的

这份协议定义 `EagleBridge` 与 `obEcraft` 的协作边界。

目标：

1. 双插件同时启用时，图片输入链不互相打断
2. Eagle localhost 图片继续被 `obEcraft` 当作正常图片处理
3. 任一插件单独启用时，行为仍完整正常

## 2. 职责边界

### EagleBridge 负责

1. 判断当前 `paste / drop` 是否应转换为 Eagle markdown
2. 区分两类来源：
   - 外部图片：先上传到 Eagle
   - Eagle 库内图片：直接转 localhost 链，不重新上传
3. 生成最终 markdown：
   - `![name.png|700](http://localhost:6060/images/XXXXX.info)`
   - 或非图片附件的 markdown link
4. 提供 Eagle 自己的右键菜单能力

### obEcraft 负责

1. 继续提供 `原生嵌入 / Ecraft嵌入`
2. 在 `Ecraft嵌入` 时接管 floating image / markdown-image / wrap / mask / zoom
3. 对 Eagle localhost 图片追加 EagleBridge 的右键菜单项

## 3. transfer 入口顺序

双插件同时启用时，顺序固定为：

1. `obEcraft` 先询问 EagleBridge integration API
2. 如果 EagleBridge 能 resolve 当前 transfer
3. EagleBridge 先返回 markdown embeds
4. `obEcraft` 再基于这份 markdown 弹自己的 `原生嵌入 / Ecraft嵌入`
5. 只有 EagleBridge 明确不处理时，`obEcraft` 才走自己的原始图片文件逻辑

一句话：

`Eagle 先 resolve transfer，obEcraft 再决定原生还是浮动。`

## 4. 两类输入链

### A. 外部图片进入 Obsidian

例如：

1. 系统截图
2. 浏览器复制图片
3. 文件管理器拖图到编辑器

规则：

1. EagleBridge 先上传到 Eagle
2. 上传成功后返回 localhost markdown
3. `obEcraft` 再决定原生嵌入还是 Ecraft 嵌入

### B. Eagle 库内图片进入 Obsidian

例如：

1. 从 Eagle 拖图到编辑器
2. 在 Eagle 里复制图片后粘贴到 Obsidian

规则：

1. EagleBridge 先识别“这已经在 Eagle 库中”
2. 直接生成 localhost markdown
3. 不重新上传 Eagle
4. 不生成 vault 本地附件
5. `obEcraft` 再决定原生嵌入还是 Ecraft 嵌入

## 5. integration API

当前与 `obEcraft` 的协作通过 `integrationApi` 暴露。

### 5.1 右键菜单

用于 markdown-image / Eagle 图片右键追加：

1. `canHandleUrl(url)`
2. `appendContextMenuItems(menu, context)`

### 5.2 transfer resolve

用于 paste / drop 入口顺序：

1. `canResolveMarkdownTransfer(data, kind)`
2. `resolveMarkdownTransfer(data, kind)`

约束：

1. `kind = paste | drop`
2. 返回 `string[]`，表示最终 markdown embeds
3. 返回 `null` 表示 Eagle 不处理
4. API 只 resolve，不直接替 `obEcraft` 写编辑器

## 6. 单插件模式要求

### 只开 EagleBridge

必须继续支持：

1. 外部图片上传到 Eagle 后生成 markdown
2. Eagle 库内图片直接生成 localhost markdown

### 与 obEcraft 双开

必须继续保证：

1. 不重复上传 Eagle
2. 不让 Eagle 库内图片落成本地附件
3. 右键项可以被 `obEcraft` 追加到同一个菜单中

## 7. 当前代码入口

- [src/main.ts](../src/main.ts)
- [src/urlHandler.ts](../src/urlHandler.ts)
- [src/menucall.ts](../src/menucall.ts)

## 8. 修改提醒

以后如果修改下面任一内容，必须同步检查这份协议：

1. `editor-paste / editor-drop`
2. Eagle 库内图片识别
3. localhost markdown 生成格式
4. integration API 字段
5. 与 `obEcraft` 的右键追加方式
