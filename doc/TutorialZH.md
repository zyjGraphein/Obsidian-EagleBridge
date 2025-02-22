# 填写端口号，librarypath 配置
第一次使用，首先需要配置好监听端口号，由 4 位数值范围是从 1000到 9999，尽可能是一个复杂的数值例如 6060。避免与常用端口号重复。且该数值一旦设置好，为保持附件链接的稳定性，不建议日后进行修改。
其次，此外还需要设置好 eagle 仓库所在的位置，需要在 eagle 软件中的左上角选择仓库，复制路径例如：D:\onedrive\eagle\仓库. Library。
由于 obsidian 和 eagle 可能通过同步，onedrive, 坚果云，硬盘等方式存在于不同的电脑上，为了确保能够有效链接，以及避免重复更改设置，该插件可以支持 eagle 的仓库多地址设置。
例如在 A 电脑上，eagle 的Library 位于 H:\directory\example. Library，而在 B 电脑上，eagle 位于 E:\xxxx\example. Library，两个仓库的内容是一样的，但位于不同的地址上。
均填写好后，当使用 A 电脑时，会自动将本地服务器映射在 D:\xxxx\eagle\仓库. Library，在使用 B 电脑时，会自动将本地服务器映射在 E:\xxxx\仓库. Library，更好的维护附件的链接。
<img src="assets/setting.png" width="600">
# 从 eagle 到obsidian
当前支持复制和拖拽两种方式将附件从 eagle 移动到 obsidian,
<img src="assets/fromeagle.gif" width="600">
适应于所有格式的附件，例如 pdf, png, mp4，url等，
其中图片类 png, jpg的文件，在复制后的格式为 ![image.png|700](http://localhost:6060/images/M7G6FALW9DRW5.info)，包含叹号，能够在 obsidian 中嵌入预览。
而其他类型的文件显示为链接形式 [image.png|700](http://localhost:6060/images/M7G6FALW9DRW4.info) 。
## 检索 eagle 图片在 obsidian 中的位置
通过在 eagle 中右键图片，复制-复制链接，随后打开 obsidian, ctrlp 加 P 使用 EagleBridge：eagle-jump-obsidian 功能（也可以绑定快捷键快速实现），粘贴对应的链接，找到图片。
<img src="assets/searchname.gif" width="600">
## 另一种检索方式
参考后文与 obsidian advanced URI 联动。
# 从 obsidian 到eagle
当前支持复制和拖拽两种方式将附件从本地直接导入 obsidian, 随后插件会自动执行上传 eagle。同样图片能够直接进行预览，有时会因为加载问题，导致图片不能立马显示，需要在链接后进行回车实现正常显示。
<img src="assets/upload.gif" width="600">
可以设置Eagle Folder lD选项，实现本地上传到指定的eagle文件夹。
<img src="assets/eaglefolderid.gif" width="600">
对于 url ，也可以进行上传管理，这是一个可选项能够在设置中打开或关闭。
<img src="assets/url.gif" width="600">
- 优势
	- 上传 url 的好处在于能够将在线资源也在 obsidian 中进行管理，实现对所有类型的资源 all in one.
- 缺点
	- 当缺点在于该链接会转换为一个本地服务器的连接，在分享文档给他人时，连接会丢失。（同理 pdf, mp 4 等的连接也会无法打开，计划后期有一个新的插件功能以实现导出 md 关联的所有的附件（包括 url） 作为一个单独的文件夹方式。同时替换链接形式以实现更好的绑定分享）
	- 上传 url 的另一个缺点在于 url 上传后 eagle 需要进行解析，获取封面等操作，这会有一个将近 10 s 的延时，如果期间进行了一些别的操作可能会造成一些错误。
	- 此外也有可能用户不希望所有的 url 都被管理。
- 补充
	- 此外该开关只针对 url 从 obsidian 到eagle，也就是当 eagle 中的链接可以直接加载到obsidian，不受到该选项的影响。并且由于其已经加载过封面，使得整个过程更加快速流畅。更加推荐这种方式进行，关闭 url 上传，然后当有不想被eagle 管理的链接直接粘贴到 obsidian 中，想要被 eagle 管理的链接，从 eagle 加载到 obsidian。
<img src="assets/urlfromeagle.gif" width="600">
# 在 obsidain 中的操作
## 图片放大预览
左键图片的右半部分实现放大预览
<img src="assets/zoom.gif" width="600">
## 默认图片尺寸控制
可以通过设置中的 image size 调整插入图片的默认尺寸。
<img src="assets/imagesize.gif" width="600">
## 选项菜单
对于 ![image.png|700](http://localhost:6060/images/M7G6FALW9DRW5.info) 图片格式能够通过右键持续按住打开选项菜单。
对于 [image.png|700](http://localhost:6060/images/M7G6FALW9DRW5.info) 链接的格式，通过左键点击打开选项菜单。
<img src="assets/menucall.gif" width="600">
### Open in obsidian
该方式用 obsidian 默认的方式打开该附件，当启用 obsidian 的核心插件 web viewer 时，能够在 obsidian 中打开对应的网址。该网址能够预览图片，视频，音频，pdf，对于 web 不支持的格式例如 ppt, word 等打开网址后无法预览显示。
### Open in eagle
该方式实现在 eagle 软件中预览该附件，有助于 eagle 中的其他插件的操作，例如 AI 去除背景，AI 放大等快速便捷的修改图片。能够实时同步到 obsidian 中对应的图片呈现。
### Open in the default app
通过默认的打开方式打开附件，例如采用默认的图片查看器打开该图片，或采用 vscode 预览. Py 的文件，根据系统默认的文件打开方式。
### Open in other apps
可以选用其他的方式打开附件，例如 PS，AI 打开图片，进行修改
### Copy source file
复制附件进行分享或移动。
### Eagle Name
显示附件的名称，点击后执行复制名称。该项与 annotation，url, tag 均作为该图片额外的信息展示，能够随时查看。
### Eagle Annotation
显示附件的注释，点击后执行复制注释。
### Eagle URL
显示附件的 URL，点击后能够跳转 URL。能够跳转到图片对应的网页或其余进程，例如 zotero。
### Eagle tag
显示附件的 tag，点击后执行复制注释。
### Modify properties
点击后能够对附件的 Annotation，URL， tag 进行修改。Tag 修改用英文`,`作为分隔符。
### Copy markdown link
便于在其他文档调用改附件链接。
### Clear markdown link
快速删除该附件链接。
## 附件同步. Md 中的tags
当文章写完，可以通过ctrl+p 搜索 EagleBridge: synchronized-page-tabs (或绑定快捷键) 实现附件的tag 与. Md 中的 tag 对齐。
<img src="assets/synch.gif" width="600">
# 与Obsidian advanced URI 联动
## 管理当前. Md 文档中所有的附件
将 obsidian advanced URI 的 Vault 设置为 id,通过在 obsidian advanced URI 中获取当前仓库的 id 链接，例如obsidian://adv-uri?vault=adbba5532cfb5f8d&uid=c5b638b9-253b-4491-891d-3d3b3633e634中，仓库的 id 为 adbba5532cfb5f8d&uid，而具体的. Md 文件的 id 为c5b638b9-253b-4491-891d-3d3b3633e634，则可以将仓库 id 填写到设置栏 Obsidian store lD 中。
随后，设置中打开 Synchronizing advanced URl as a tag 选项，执行 EagleBridge: synchronized-page-tabs ，则可以将. Md 的 id 作为c5b638b9-253b-4491-891d-3d3b3633e634 一个 tag。
在 eagle 中右键该 tag, 搜索包含标签的项目，即可在 eagle 中展示该. Md 中所有相关的附件。
## 检索 eagle 图片在 obsidian 中的位置（另一种方式）
如果使用 obsidian advanced URI，并将 URI 作为图片 tag 进行了储存，可以复制图片 tag 中的. Md 的 id，然后在 EagleBridge：eagle-jump-obsidian 中粘贴 id，实现跳转对应的 md 文档。
<img src="assets/searchid.gif" width="600">