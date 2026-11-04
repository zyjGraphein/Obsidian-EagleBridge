import { Setting } from 'obsidian';
import type { MyPluginSettings } from './setting';

export type UiLang = 'zh' | 'en';

/**
 * Settings panel copy, keyed by the English source string.
 *
 * `ebT()` is a no-op unless the user switches the panel to Chinese, so English
 * behaviour is completely unchanged.
 */
export const EB_ZH: Record<string, string> = {
	// --- tab labels ---
	'Libraries': '图库',
	'Upload': '上传',
	'Preview': '预览',
	'Sync': '同步',
	'Advanced': '高级',

	// --- section / card titles ---
	'Library list': '图库列表',
	'Library details': '图库详情',
	'Library paths': '图库路径',
	'Image upload': '图片上传',
	'Upload destination': '上传目标',
	'Upload from': '上传来源',
	'File types': '文件类型',
	'Display preferences': '预览与点击',
	'Image insertion': '插入图片',
	'Open attachments': '打开附件',
	'Metadata sync': '元数据同步',
	'Attachment tag sync': '附件标签同步',
	'Obsidian link sync': 'Obsidian 反向链接同步',
	'Maintenance': '维护',
	'Local preview': '本地预览',

	// --- setting names ---
	'Adaptive display ratio': '自适应显示比例',
	'Alias': '别名',
	'Annotation': '注解',
	'Auto send page link to Eagle': '自动发送页面链接到 Eagle',
	'Canvas': '画布',
	'Click to view images': '点击查看大图',
	'Custom rules': '自定义规则',
	'Debug mode': '调试模式',
	'Default library': '默认图库',
	'Destination': '目标位置',
	'Destination path': '目标路径',
	'Device paths': '设备路径',
	'Export': '导出',
	'File name': '文件名',
	'Fixed width': '统一宽度',
	'Image file name': '图片文件名',
	'Image size': '图片宽度（基准）',
	'Images': '图片',
	'Interface language': '界面语言',
	'Landscape ratio': '横图倍率',
	'Landscape width': '横图宽度',
	'Markdown': 'Markdown',
	'Multi-image separator': '多图插入方式',
	'Naming mode': '命名方式',
	'Obsidian store ID': 'Obsidian 库标识',
	'Open in Obsidian': '在 Obsidian 中打开',
	'Other files': '其它文件',
	'Package format': '打包格式',
	'Port': '端口',
	'Portrait ratio': '竖图倍率',
	'Portrait width': '竖图宽度',
	'Refresh servers': '刷新服务',
	'Replace Eagle tags': '覆盖 Eagle 标签',
	'Size mode': '宽度模式',
	'Source note': '来源笔记',
	'Square aligns to': '方图对齐',
	'Square base width': '方图基准宽度',
	'Sync direction': '同步方向',
	'Tags': '标签',
	'Upload folder ID': '上传文件夹 ID',
	'Upload to Eagle': '上传到 Eagle',
	'URL': 'URL',
	'Videos': '视频',
	'Web links': '网页链接',

	// --- setting descriptions ---
	'Click the right half of the image to view the image in detail.': '点击图片右半边可查看大图。',
	'Every image uses this width. Leave blank to keep the original size.': '所有图片都用这个宽度。留空则保持原图尺寸。',
	'Folder keeps plain files. ZIP creates a compressed package with the same structure.': '文件夹：保留原始文件；ZIP：打包成同结构的压缩包。',
	'For files dragged or pasted from outside Eagle.': '适用于从 Eagle 外部拖入或粘贴的文件。',
	'Keep this port stable to preserve existing links.': '保持此端口不变，否则已有链接会失效。',
	'Landscape width = square base × this value.': '横图宽度 ＝ 方图基准 × 此值。',
	'Maximum preview size relative to the window.': '预览图相对窗口的最大尺寸。',
	'Near-square images follow one of the two widths above.': '近似方形的图片，跟着上面两个宽度里的哪一个走。',
	'Optional. Leave blank to use the library root.': '可选。留空则使用图库根目录。',
	'Overwrite existing Eagle tags with the page tags.': '用页面标签覆盖 Eagle 中已有的标签。',
	'PDF, audio and other attachments.': 'PDF、音频等其它附件。',
	'Portrait width = square base × this value. Default 1.': '竖图宽度 ＝ 方图基准 × 此值，默认 1。',
	'Send a backlink for new attachments. Requires a YAML id on the page.': '为新附件发送反向链接。需要页面 YAML 中有 id 字段。',
	'Separate tags use ,': '多个标签用英文逗号分隔',
	'Switch the language of these settings.': '切换设置面板的语言。',
	'The Web Viewer core plugin must be enabled to use popup or pane modes.': '弹窗/侧边栏需先启用 Web Viewer 核心插件。',
	'Upload external files when dragging or pasting.': '拖入或粘贴外部文件时自动上传。',
	'Vault identifier used in obsidian://adv-uri links.': '用于 obsidian://adv-uri 链接的库标识。',
	'Width for near-square images. Leave blank to keep the original size.': '方图宽度，横竖图按倍率换算。留空保持原图。',
	'Width in pixels for landscape images.': '横向图片（宽大于高）的像素宽度。',
	'Width in pixels for portrait images.': '纵向图片（高大于宽）的像素宽度。',
	'Width in pixels. Leave blank for original size.': '像素宽度。留空则使用原图尺寸。',
	'Write diagnostic messages to the developer console.': '在开发者控制台输出诊断信息。',
	'Applies to this settings panel.': '只影响这个设置面板的文字。',
	'Avoid symbols such as [ ] in source file names clashing with Obsidian syntax. File names are cleaned by default; you can define your own rule.': '避免素材文件名的 [ ] 等符号与 Obsidian 语法冲突，默认对文件名进行处理，可自定义处理方式。',
	'File names from your image sources often contain symbols such as [ ], which conflict with Obsidian\'s image syntax. Names are cleaned here so the embed stays valid.': '收图来的文件名常带 [ ] 之类的符号，会和 Obsidian 的图片语法冲突，所以这里先把名字处理干净。',
	'Format: from=>to, comma-separated.': '写法：原=>新，多组用逗号分隔。',
	'Only the initial width written into the note when you drag or paste an image. Change it later by editing the number after | in the note.': '只决定拖入 / 粘贴图片时写进笔记的初始宽度。之后随时可以改：把图片语法里 | 后面的数字改掉即可。',
	'Size mode: Square as base uses one square width, landscape and portrait scale from it.': '以方图为基准：定一个方图宽度，横图和竖图按倍率换算。',
	'Strip: remove [ ] ( ) | < >\nReplace: swap them to full-width\nNumbered: note title + index\nCustom: your own rules': '去除：删掉 [ ] ( ) | < > 等符号\n替代：换成全角括号\n编号：笔记标题 + 序号\n自定义：自己写规则',
	'How to join the images when several are dragged or pasted at once.\nSide by side: written on the same line, so they flow into one row.\nSame line with a space: one extra gap between them.\nOne per line: each image own its own line.': '一次拖入或粘贴多张图时，图与图之间怎么接。\n紧贴成排：写在同一行，空间够就自动并排。\n同行留空：同一行，但图之间隔一个空格。\n一行一张：每张图各占一行。',

	// --- dropdown options ---
	'Append page tags to Eagle': '把页面标签追加到 Eagle',
	'Ask every time': '每次询问',
	'Explicit landscape / portrait width': '横竖分别指定像素',
	'Fixed size': '固定大小',
	'Fixed target': '固定目标',
	'Folder': '文件夹',
	'Import Eagle tags to YAML': '把 Eagle 标签导入 YAML',
	'Landscape': '横图',
	'Note title - index': '笔记标题-序号',
	'Off': '关闭',
	'Open in new page': '在新页面打开',
	'Open in popup': '在弹窗中打开',
	'Open in right pane': '在右侧栏打开',
	'Portrait': '竖图',
	'Replace with full-width 【】（etc.)': '替换为全角【】（等）',
	'Square as base × ratios': '以方图为基准算倍率',
	'One per line': '一行一张',
	'Side by side (same line)': '紧贴成排（同一行）',
	'Same line with a space': '同行，中间留空',
	'Strip dangerous characters (default)': '去除危险字符（默认）',
	'ZIP': 'ZIP',

	// --- buttons / status ---
	'Add library': '添加图库',
	'Add path': '添加路径',
	'Add the path to your .library folder.': '填入 .library 文件夹的路径。',
	'Available on this device': '本机可用',
	'Enter image size': '输入宽度',
	'Enter library path': '输入图库路径',
	'Library path not found': '找不到图库路径',
	'Path': '路径',
	'Refresh now': '立即刷新',
	'Save': '保存',
};

export function normalizeUiLang(value: unknown): UiLang {
	return value === 'zh' ? 'zh' : 'en';
}

export function ebT(text: string, settings?: MyPluginSettings | null): string {
	if (!text) {
		return text;
	}
	if (!settings || normalizeUiLang(settings.uiLang) !== 'zh') {
		return text;
	}
	return EB_ZH[text] ?? text;
}

/**
 * A `Setting` that translates its own name / description.
 * Everything else (dropdowns, toggles, buttons) behaves exactly like the base class.
 */
export class EBSetting extends Setting {
	private readonly ebSettings: MyPluginSettings;

	constructor(containerEl: HTMLElement, settings: MyPluginSettings) {
		super(containerEl);
		this.ebSettings = settings;
	}

	setName(name: string | DocumentFragment): this {
		return super.setName(typeof name === 'string' ? ebT(name, this.ebSettings) : name);
	}

	setDesc(desc: string | DocumentFragment): this {
		super.setDesc(typeof desc === 'string' ? ebT(desc, this.ebSettings) : desc);
		// 描述里允许用 \n 分成多行（例如每个选项单独一行），默认会被折叠成空格
		if (typeof desc === 'string' && desc.indexOf('\n') !== -1) {
			this.descEl.style.whiteSpace = 'pre-line';
		}
		return this;
	}
}
