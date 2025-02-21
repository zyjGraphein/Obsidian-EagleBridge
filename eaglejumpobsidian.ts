import { App, Modal, Notice, Setting, MarkdownView } from 'obsidian';
import { MyPluginSettings } from './main';
import { print, setDebug } from './main';

export class EagleJumpModal extends Modal {
	private onSubmit: (link: string) => void;
	private settings: MyPluginSettings;

	constructor(app: App, settings: MyPluginSettings, onSubmit: (link: string) => void) {
		super(app);
		this.settings = settings;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: '请输入链接' });

		let linkInput: HTMLInputElement;

		new Setting(contentEl)
			.addText(text => {
				linkInput = text.inputEl;
				text.setPlaceholder('link...');
				linkInput.style.width = '400px'; // 设置文本框宽度为400
			});

		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '10px'; // 设置按钮之间的间距

		new Setting(buttonContainer)
			.addButton(btn => btn
				.setButtonText('Run jump')
				.setCta()
				.onClick(() => {
					const link = linkInput.value.trim();
					if (link) {
						// 检查链接格式
						const eaglePattern = /^eagle:\/\/item\/([A-Z0-9]+)$/;
						const uuidPattern = /^[0-9a-fA-F-]{36}$/;
						const imagePattern = /http:\/\/localhost:\d+\/images\/([A-Z0-9]+)\.info/;

						const eagleMatch = link.match(eaglePattern);
						const uuidMatch = link.match(uuidPattern);
						const imageMatch = link.match(imagePattern);

						if (eagleMatch || imageMatch) {
							// 如果是 eagle://item/ 或者图片链接格式，使用 Obsidian 的搜索功能
							const itemId = eagleMatch ? eagleMatch[1] : (imageMatch ? imageMatch[1] : null);
							if (itemId) {
								print(`搜索 Obsidian 中的 ID: ${itemId}`);
								// 使用类型断言来访问 commands
								(this.app as any).commands.executeCommandById('app:open-search');
								const searchLeaf = this.app.workspace.getLeavesOfType('search')[0];
								if (searchLeaf) {
									const searchView = searchLeaf.view;
									(searchView as any).setQuery(itemId);
								}
							} else {
								new Notice('无法提取有效的 ID');
							}
						} else if (uuidMatch) {
							// 如果是 UUID 格式，构建 obsidian://adv-uri 链接
							const obsidianStoreId = this.settings.obsidianStoreId;
							const advUri = `obsidian://adv-uri?vault=${obsidianStoreId}&uid=${link}`;
							print(`运行链接: ${advUri}`);
							window.open(advUri, '_blank');
						} else {
							new Notice('请输入有效的链接');
						}

						this.close();
					} else {
						new Notice('请输入有效的链接');
					}
				}));

		new Setting(buttonContainer)
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => {
					this.close();
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// 使用示例
export function jumpModal(app: App, settings: MyPluginSettings) {
	new EagleJumpModal(app, settings, (link) => {
		print('用户输入的链接:', link);
	}).open();
}