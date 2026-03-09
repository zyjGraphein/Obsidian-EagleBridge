import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import MyPlugin from './main';
import { startServer, refreshServer, stopServer } from './server';

export interface EagleUploadSettings {
	enabled: boolean;
	markdown: boolean;
	canvas: boolean;
	image: boolean;
	video: boolean;
	website: boolean;
	other: boolean;
}

export interface MyPluginSettings {
	mySetting: string;
	port: number;
	libraryPath: string;
	folderId?: string;
	clickView: boolean;
	adaptiveRatio: number;
	advancedID: boolean;
	obsidianStoreId: string;
	imageSize: number | undefined;
	upload: EagleUploadSettings;
	libraryPaths: string[];
	debug: boolean;
	openInObsidian: string;
}

export const DEFAULT_UPLOAD_SETTINGS: EagleUploadSettings = {
	enabled: true,
	markdown: true,
	canvas: true,
	image: true,
	video: true,
	website: false,
	other: true,
};

export const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	port: 6060,
	libraryPath: '',
	folderId: '',
	clickView: false,
	adaptiveRatio: 0.8,
	advancedID: false,
	obsidianStoreId: '',
	imageSize: undefined,
	upload: { ...DEFAULT_UPLOAD_SETTINGS },
	libraryPaths: [],
	debug: false,
	openInObsidian: 'newPage',
}

type LegacyUploadSettings = Partial<EagleUploadSettings> & {
	pdf?: boolean;
	website?: boolean;
};

export function normalizeUploadSettings(data: { upload?: LegacyUploadSettings; websiteUpload?: boolean } | null | undefined): EagleUploadSettings {
	const upload = data?.upload ?? {};
	const legacyWebsiteUpload = typeof data?.websiteUpload === 'boolean' ? data.websiteUpload : undefined;
	const hasLegacyOtherEnabled = upload.pdf === true || typeof upload.other === 'boolean';

	return {
		...DEFAULT_UPLOAD_SETTINGS,
		...upload,
		markdown: typeof upload.markdown === 'boolean' ? upload.markdown : DEFAULT_UPLOAD_SETTINGS.markdown,
		canvas: typeof upload.canvas === 'boolean' ? upload.canvas : DEFAULT_UPLOAD_SETTINGS.canvas,
		website: typeof upload.website === 'boolean'
			? upload.website
			: legacyWebsiteUpload ?? DEFAULT_UPLOAD_SETTINGS.website,
		other: typeof upload.other === 'boolean'
			? upload.other
			: hasLegacyOtherEnabled
				? true
				: DEFAULT_UPLOAD_SETTINGS.other,
	};
}


export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Port')
			.setDesc('Enter the port number of the server, ranging from 1000 to 9999, and do not modify it after setting.')
			.addText(text => text
				.setPlaceholder('Enter port number')
				.setValue(this.plugin.settings.port.toString())
				.onChange(async (value) => {
					this.plugin.settings.port = parseInt(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Library Paths')
			.setDesc(`Enter multiple library paths for the server. Current valid path: ${this.plugin.settings.libraryPath}`)
			.addButton(button => {
				button.setButtonText('+')
					.setCta()
					.onClick(() => {
						this.plugin.settings.libraryPaths.push('');
						this.plugin.saveSettings();
						this.display(); // 重新渲染设置界面
					});
			});
	
			this.plugin.settings.libraryPaths.forEach((path, index) => {
				new Setting(containerEl)
					.addText(text => text
						.setPlaceholder('Enter library path')
						.setValue(path)
						.onChange(async (value) => {
							this.plugin.settings.libraryPaths[index] = value;
							await this.plugin.saveSettings();
							await this.plugin.updateLibraryPath(); // 更新Library Path
							this.display(); // 重新渲染设置界面
						}))
					.addExtraButton(button => {
						button.setIcon('cross')
							.setTooltip('Remove')
							.onClick(async () => {
								this.plugin.settings.libraryPaths.splice(index, 1);
								await this.plugin.saveSettings();
								await this.plugin.updateLibraryPath(); // 更新Library Path
								this.display(); // 重新渲染设置界面
							});
					});
			});
		// new Setting(containerEl)
		// 	.setName('Current Library Path')
		// 	.setDesc('The first valid library path')
		// 	.addText(text => text
		// 		.setValue(this.plugin.settings.libraryPath)
		// 		.setDisabled(true)); // 禁用输入框，只显示有效路径

		new Setting(containerEl)
			.setName('Eagle Folder ID')
			.setDesc('Enter the folder ID for Eagle')
			.addText(text => text
				.setPlaceholder('Enter folder ID')
				.setValue(this.plugin.settings.folderId || '')
				.onChange(async (value) => {
					this.plugin.settings.folderId = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
		.setName('Image size')
		.setDesc('Default size for image import')
		.addText(text => text
			.setPlaceholder('Enter image size')
			.setValue(this.plugin.settings.imageSize?.toString() || '')
			.onChange(async (value) => {
				this.plugin.settings.imageSize = value ? parseInt(value) : undefined;
				await this.plugin.saveSettings();
			}));

        new Setting(containerEl)
            .setName("Click to view images")
            .setDesc("Click the right half of the image to view the image in detail.")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.clickView)
                    .onChange(async (value) => {
                        this.plugin.settings.clickView = value;
                        await this.plugin.saveSettings();
                    });
            });

		new Setting(containerEl)
		.setName('Adaptive image display ratio based on window size')
		.setDesc('When the image exceeds the window size, the image is displayed adaptively according to the window size.')
		.addSlider((slider) => {
			slider.setLimits(0.1, 1, 0.05);
			slider.setValue(this.plugin.settings.adaptiveRatio);
			slider.onChange(async (value) => {
				this.plugin.settings.adaptiveRatio = value;
				new Notice(`Adaptive ratio: ${value}`);
				await this.plugin.saveSettings();
			});
			slider.setDynamicTooltip();
		});

		new Setting(containerEl)
            .setName("Synchronizing advanced URI as a tag")
            .setDesc("Synchronize advanced URI as a tag when page ids exist.")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.advancedID)
                    .onChange(async (value) => {
                        this.plugin.settings.advancedID = value;
                        await this.plugin.saveSettings();
                    });
            });

		new Setting(containerEl)
			.setName('Obsidian store ID')
			.setDesc('Enter the Obsidian store ID')
			.addText(text => text
				.setPlaceholder('Enter Obsidian store ID')
				.setValue(this.plugin.settings.obsidianStoreId)
				.onChange(async (value) => {
					this.plugin.settings.obsidianStoreId = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
		.setName('Open in obsidian')
		.setDesc('Default opening of attachments in obsidian')
		.addDropdown(dropdown => {
			dropdown.addOption('newPage', 'Open in new page')
				.addOption('popup', 'Open in popup')
				.addOption('rightPane', 'Open in right pane')
				.setValue(this.plugin.settings.openInObsidian || 'newPage')
				.onChange(async (value) => {
					this.plugin.settings.openInObsidian = value;
					await this.plugin.saveSettings();
				});
		});

		const uploadSettingsContainer = containerEl.createDiv({ cls: 'eagle-upload-panel' });

		new Setting(uploadSettingsContainer)
			.setName('Attachment upload')
			.setDesc('Master switch for uploading dragged or pasted external content to Eagle.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.enabled)
					.onChange(async (value) => {
						this.plugin.settings.upload.enabled = value;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		const uploadTypesDetails = uploadSettingsContainer.createEl('details', { cls: 'eagle-upload-details' });
		uploadTypesDetails.open = this.plugin.settings.upload.enabled;
		uploadTypesDetails.createEl('summary', { text: 'Configure upload rules' });
		const uploadGrid = uploadTypesDetails.createDiv({ cls: 'eagle-upload-grid' });
		const uploadTargetCard = uploadGrid.createDiv({ cls: 'eagle-upload-card' });
		const uploadFormatCard = uploadGrid.createDiv({ cls: 'eagle-upload-card' });

		uploadTargetCard.createEl('h3', { text: 'Obsidian type' });
		uploadTargetCard.createEl('p', {
			text: 'Choose which Obsidian document types are allowed to trigger Eagle upload.',
			cls: 'eagle-upload-card-desc',
		});

		new Setting(uploadTargetCard)
			.setName('Markdown upload')
			.setDesc('Handle paste and drag events inside Markdown editors.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.markdown)
					.onChange(async (value) => {
						this.plugin.settings.upload.markdown = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(uploadTargetCard)
			.setName('Canvas upload')
			.setDesc('Handle paste and drag events inside Canvas views.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.canvas)
					.onChange(async (value) => {
						this.plugin.settings.upload.canvas = value;
						await this.plugin.saveSettings();
					});
			});

		uploadFormatCard.createEl('h3', { text: 'Content type' });
		uploadFormatCard.createEl('p', {
			text: 'Choose which dragged or pasted content types should be uploaded to Eagle.',
			cls: 'eagle-upload-card-desc',
		});

		new Setting(uploadFormatCard)
			.setName('Image upload')
			.setDesc('Upload image files to Eagle.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.image)
					.onChange(async (value) => {
						this.plugin.settings.upload.image = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(uploadFormatCard)
			.setName('Video upload')
			.setDesc('Upload video files to Eagle.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.video)
					.onChange(async (value) => {
						this.plugin.settings.upload.video = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(uploadFormatCard)
			.setName('Website upload')
			.setDesc('URL uploaded to eagle. note: 1. eagle will automatically get the cover, with a certain delay. 2. when exporting notes to share, may not be able to jump effectively. 3. This option does not affect links dragged/copied from eagle to obsidian. Large delay may occur, not recommended to enable.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.website)
					.onChange(async (value) => {
						this.plugin.settings.upload.website = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(uploadFormatCard)
			.setName('Other upload')
			.setDesc('Upload PDF and other non-image, non-video files to Eagle.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.other)
					.onChange(async (value) => {
						this.plugin.settings.upload.other = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Refresh Server')
			.setDesc('Refresh the server with the new settings')
			.addButton(button => button
				.setButtonText('Refresh')
				.onClick(() => {
					refreshServer(this.plugin.settings.libraryPath, this.plugin.settings.port);
				}));

		new Setting(containerEl)
			.setName('Debug Mode')
			.setDesc('Enable or disable debug mode')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debug)
				.onChange(async (value) => {
					this.plugin.settings.debug = value;
					await this.plugin.saveSettings();
				}));
			
	}
}
