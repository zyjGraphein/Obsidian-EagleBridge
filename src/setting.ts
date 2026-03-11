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

export type AttachmentTagSyncMode = 'off' | 'appendPageTagsToEagle' | 'importEagleTagsToYaml';
export type MarkdownExportFormat = 'folder' | 'zip';

export interface MyPluginSettings {
	mySetting: string;
	port: number;
	libraryPath: string;
	folderId?: string;
	clickView: boolean;
	adaptiveRatio: number;
	attachmentTagSyncMode: AttachmentTagSyncMode;
	exactSyncPageTagsToEagle: boolean;
	autoSyncObsidianLinkToEagle: boolean;
	obsidianStoreId: string;
	imageSize: number | undefined;
	upload: EagleUploadSettings;
	libraryPaths: string[];
	debug: boolean;
	openInObsidian: string;
	markdownExportFormat: MarkdownExportFormat;
	markdownExportDestinationPath: string;
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
	attachmentTagSyncMode: 'off',
	exactSyncPageTagsToEagle: false,
	autoSyncObsidianLinkToEagle: false,
	obsidianStoreId: '',
	imageSize: undefined,
	upload: { ...DEFAULT_UPLOAD_SETTINGS },
	libraryPaths: [],
	debug: false,
	openInObsidian: 'newPage',
	markdownExportFormat: 'folder',
	markdownExportDestinationPath: '',
}

type LegacyUploadSettings = Partial<EagleUploadSettings> & {
	pdf?: boolean;
	website?: boolean;
};

type LegacyTagSyncSettings = {
	attachmentTagSyncMode?: AttachmentTagSyncMode;
	exactSyncPageTagsToEagle?: boolean;
	autoSyncPageTags?: boolean;
	importEagleTagsToYaml?: boolean;
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

export function normalizeAttachmentTagSyncMode(data: LegacyTagSyncSettings | null | undefined): AttachmentTagSyncMode {
	const savedMode = data?.attachmentTagSyncMode;
	if (savedMode === 'off' || savedMode === 'appendPageTagsToEagle' || savedMode === 'importEagleTagsToYaml') {
		return savedMode;
	}

	if (data?.importEagleTagsToYaml) {
		return 'importEagleTagsToYaml';
	}

	if (data?.autoSyncPageTags) {
		return 'appendPageTagsToEagle';
	}

	return 'off';
}

export function isAppendPageTagsMode(settings: MyPluginSettings): boolean {
	return settings.attachmentTagSyncMode === 'appendPageTagsToEagle';
}

export function isImportEagleTagsMode(settings: MyPluginSettings): boolean {
	return settings.attachmentTagSyncMode === 'importEagleTagsToYaml';
}

export function shouldReplacePageTagsInEagle(settings: MyPluginSettings): boolean {
	return isAppendPageTagsMode(settings) && settings.exactSyncPageTagsToEagle;
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

		const attachmentTagSyncPanel = containerEl.createDiv({ cls: 'eagle-tag-sync-panel' });
		attachmentTagSyncPanel.createEl('h3', { text: 'Attachment tag sync' });
		attachmentTagSyncPanel.createEl('p', {
			text: 'Choose a single direction for automatic tag updates when Eagle attachments enter the page.',
			cls: 'eagle-tag-sync-panel-desc',
		});

		new Setting(attachmentTagSyncPanel)
			.setName('Sync direction')
			.setDesc('Use one mode at a time to avoid recursive tag changes across the page.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('off', 'Off')
					.addOption('appendPageTagsToEagle', 'Append page tags to Eagle')
					.addOption('importEagleTagsToYaml', 'Import Eagle tags to YAML')
					.setValue(this.plugin.settings.attachmentTagSyncMode)
					.onChange(async (value: AttachmentTagSyncMode) => {
						this.plugin.settings.attachmentTagSyncMode = value;
						await this.plugin.saveSettings();
						this.plugin.refreshAutoTagSyncState();
						this.display();
					});
			});

		if (this.plugin.settings.attachmentTagSyncMode === 'appendPageTagsToEagle') {
			const appendModeCard = attachmentTagSyncPanel.createDiv({ cls: 'eagle-tag-sync-subcard' });
			new Setting(appendModeCard)
				.setName('Exact align tags')
				.setDesc('Replace Eagle item tags with the current page tags instead of only appending missing tags.')
				.addToggle((toggle) => {
					toggle.setValue(this.plugin.settings.exactSyncPageTagsToEagle)
						.onChange(async (value) => {
							this.plugin.settings.exactSyncPageTagsToEagle = value;
							await this.plugin.saveSettings();
							this.plugin.refreshAutoTagSyncState();
							this.display();
						});
				});
		}

		const attachmentTagSyncHint = attachmentTagSyncPanel.createDiv({ cls: 'eagle-tag-sync-hint' });
		const activeModeText = this.plugin.settings.attachmentTagSyncMode === 'appendPageTagsToEagle'
			? this.plugin.settings.exactSyncPageTagsToEagle
				? 'Exact align mode: Eagle items in the page are overwritten to match the current page tags.'
				: 'Append mode: when page tags or Eagle links change, Eagle items in the page only receive missing page tags.'
			: this.plugin.settings.attachmentTagSyncMode === 'importEagleTagsToYaml'
				? 'Import mode: when a new Eagle attachment is added to the page, its Eagle tags are merged into YAML tags.'
				: 'Off mode: page tags and Eagle tags stay independent unless you run the manual append command.';
		attachmentTagSyncHint.setText(activeModeText);

		const obsidianLinkSyncPanel = containerEl.createDiv({ cls: 'eagle-obsidian-link-panel' });
		obsidianLinkSyncPanel.createEl('h3', { text: 'Obsidian link sync' });
		obsidianLinkSyncPanel.createEl('p', {
			text: 'Send the current page advanced URI to Eagle. The command always works; automatic mode only runs when new Eagle attachments appear in a page that already has YAML id.',
			cls: 'eagle-obsidian-link-panel-desc',
		});

		new Setting(obsidianLinkSyncPanel)
			.setName('Auto send page link to Eagle')
			.setDesc('When new Eagle items are added into the current Markdown page, automatically write the page advanced URI into their Obsidian metadata.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.autoSyncObsidianLinkToEagle)
					.onChange(async (value) => {
						this.plugin.settings.autoSyncObsidianLinkToEagle = value;
						await this.plugin.saveSettings();
						this.plugin.refreshAutoTagSyncState();
					});
			});

		new Setting(obsidianLinkSyncPanel)
			.setName('Obsidian store ID')
			.setDesc('Vault identifier used in obsidian://adv-uri links.')
			.addText(text => text
				.setPlaceholder('Enter Obsidian store ID')
				.setValue(this.plugin.settings.obsidianStoreId)
				.onChange(async (value) => {
					this.plugin.settings.obsidianStoreId = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
		.setName('Open in obsidian')
		.setDesc('Default opening of attachments in obsidian. Note: The Web Viewer must be enabled in the core plugin to use this feature. ')
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
