import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import MyPlugin from './main';
import { startServer, refreshServer, stopServer } from './server';

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
	websiteUpload: boolean;
	libraryPaths: string[];
	debug: boolean;
}

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
	websiteUpload: false,
	libraryPaths: [],
	debug: false,
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
			.setDesc('Enter the port number of the server, ranging from 1000 to 65535, and do not modify it after setting.')
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
		.setName('Website upload')
		.setDesc('URL uploaded to eagle. note: 1. eagle will automatically get the cover, with a certain delay. 2. when exporting notes to share, may not be able to jump effectively. 3.This option does not affect links dragged/copied from eagle to obsidian.')
		.addToggle((toggle) => {
			toggle.setValue(this.plugin.settings.websiteUpload)
				.onChange(async (value) => {
					this.plugin.settings.websiteUpload = value;
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