import { App, Modal, Notice, Setting, MarkdownView } from 'obsidian';
import { MyPluginSettings } from './setting';
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
		contentEl.createEl('h3', { text: 'Please enter Page id or Eagle image link' });

		let linkInput: HTMLInputElement;

		new Setting(contentEl)
			.addText(text => {
				linkInput = text.inputEl;
				text.setPlaceholder('link...');
				linkInput.style.width = '400px'; // 设置文本框宽度为400
			});

		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.display = 'flex';
		// buttonContainer.style.gap = '10px'; // 设置按钮之间的间距
		buttonContainer.style.alignItems = 'end'; // 确保按钮在同一行上
		buttonContainer.style.justifyContent = 'center'; // 确保按钮在同一行上

		new Setting(buttonContainer)
			.addButton(btn => btn
				.setButtonText('Jump')
				.setCta()
				.onClick(() => {
					const link = linkInput.value.trim();
					if (link) {
						// 检查链接格式
						const eaglePattern = /^eagle:\/\/item\/([A-Z0-9]+)$/;
						const uuidPattern = /^.+$/; // 匹配任意非空字符串
						const imagePattern = /http:\/\/localhost:\d+\/images\/([A-Z0-9]+)\.info/;

						const eagleMatch = link.match(eaglePattern);
						const uuidMatch = link.match(uuidPattern);
						const imageMatch = link.match(imagePattern);

						if (eagleMatch || imageMatch) {
							// 如果是 eagle://item/ 或者图片链接格式，使用 Obsidian 的搜索功能
							const itemId = eagleMatch ? eagleMatch[1] : (imageMatch ? imageMatch[1] : null);
							if (itemId) {
								print(`Search ID in Obsidian: ${itemId}`);
								// 打开搜索面板
								let searchLeaf = this.app.workspace.getLeavesOfType('search')[0];
								if (!searchLeaf) {
									searchLeaf = this.app.workspace.getLeaf(true); // 获取一个新的叶子
									searchLeaf.setViewState({ type: 'search' }); // 设置视图类型为搜索
								}
								this.app.workspace.revealLeaf(searchLeaf);
								const searchView = searchLeaf.view;
								if (searchView && typeof (searchView as any).setQuery === 'function') {
									(searchView as any).setQuery(itemId);
								} else {
									new Notice('Search view does not support setQuery');
								}
							} else {
								new Notice('Cannot extract a valid ID');
							}
						} else if (uuidMatch) {
							// 如果是 UUID 格式，构建 obsidian://adv-uri 链接
							const obsidianStoreId = this.settings.obsidianStoreId;
							const advUri = `obsidian://adv-uri?vault=${obsidianStoreId}&uid=${link}`;
							print(`Run link: ${advUri}`);
							window.open(advUri, '_blank');
						} else {
							new Notice('Please enter a valid link');
						}
						this.close();
					} else {
						new Notice('Please enter a valid link');
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
		print(`User input link: ${link}`);
	}).open();
}