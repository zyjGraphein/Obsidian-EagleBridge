import { App, PluginSettingTab, Setting, Notice, setIcon, setTooltip } from 'obsidian';
import MyPlugin from './main';
import { createEmptyLibraryProfile, getResolvedLibraryProfiles, MAX_LIBRARY_PROFILES } from './libraryProfiles';

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
export type ExternalUploadMode = 'fixed' | 'askEveryTime';

export interface EagleLibraryProfileSettings {
	id: string;
	alias: string;
	servePort: number;
	paths: string[];
	resolvedPath: string;
	folderId: string;
	enabled: boolean;
}

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
	libraryProfiles: EagleLibraryProfileSettings[];
	externalUploadMode: ExternalUploadMode;
	defaultUploadTargetId: string;
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
	libraryProfiles: [],
	externalUploadMode: 'fixed',
	defaultUploadTargetId: '',
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

export function normalizeExternalUploadMode(value: unknown): ExternalUploadMode {
	return value === 'askEveryTime' ? 'askEveryTime' : 'fixed';
}

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

type SettingsPageKey = 'libraries' | 'upload' | 'viewer' | 'sync' | 'advanced';

export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;
	private profileRefreshTimer: number | null = null;
	private activePage: SettingsPageKey = 'libraries';
	private activeProfileId: string | null = null;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private queueLibraryProfileRefresh(repaint = false): void {
		if (this.profileRefreshTimer !== null) {
			window.clearTimeout(this.profileRefreshTimer);
		}

		this.profileRefreshTimer = window.setTimeout(() => {
			this.profileRefreshTimer = null;
			void (async () => {
				await this.plugin.refreshLibraryProfilesAndServers();
				if (repaint) {
					const active = this.containerEl.ownerDocument.activeElement as HTMLInputElement | null;
					const inputs = Array.from(this.containerEl.querySelectorAll('input'));
					const index = active ? inputs.indexOf(active) : -1;
					const selection = index >= 0 ? [active!.selectionStart, active!.selectionEnd] : null;
					this.display();
					if (selection) {
						const input = this.containerEl.querySelectorAll('input')[index];
						input?.focus({ preventScroll: true });
						input?.setSelectionRange(selection[0], selection[1]);
					}
				}
			})();
		}, 250);
	}

	private ensureActiveProfileId(profileIds: string[]): string | null {
		if (this.activeProfileId && profileIds.includes(this.activeProfileId)) {
			return this.activeProfileId;
		}

		this.activeProfileId = profileIds[0] ?? null;
		return this.activeProfileId;
	}

	private createShell(containerEl: HTMLElement): HTMLElement {
		containerEl.empty();
		containerEl.addClass('eagle-settings-root');

		const shellEl = containerEl.createDiv({ cls: 'eagle-settings-shell' });
		shellEl.createEl('h2', { text: 'EagleBridge', cls: 'eagle-settings-title' });

		const navEl = shellEl.createEl('nav', {
			cls: 'eagle-settings-nav',
			attr: {
				role: 'tablist',
				'aria-orientation': 'horizontal',
			},
		});
		this.createPageButton(navEl, 'libraries', 'Libraries');
		this.createPageButton(navEl, 'upload', 'Upload');
		this.createPageButton(navEl, 'viewer', 'Preview');
		this.createPageButton(navEl, 'sync', 'Sync');
		this.createPageButton(navEl, 'advanced', 'Advanced');

		return shellEl.createDiv({ cls: 'eagle-settings-content', attr: { role: 'tabpanel' } });
	}

	private createPageButton(parentEl: HTMLElement, page: SettingsPageKey, title: string): void {
		const buttonEl = parentEl.createEl('button', {
			cls: `eagle-settings-nav-button ${this.activePage === page ? 'is-active' : ''}`,
			type: 'button',
			attr: {
				role: 'tab',
				'aria-selected': this.activePage === page ? 'true' : 'false',
			},
		});
		buttonEl.setText(title);
		buttonEl.addEventListener('click', () => {
			if (this.activePage === page) {
				return;
			}
			this.activePage = page;
			this.display();
			this.containerEl.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
		});
	}

	private createSection(
		parentEl: HTMLElement,
		title: string,
		description: string,
		options: { className?: string; actionText?: string; onAction?: () => void } = {},
	): HTMLElement {
		const sectionEl = parentEl.createDiv({
			cls: `eagle-settings-section ${options.className ?? ''}`.trim(),
		});
		const headerEl = sectionEl.createDiv({ cls: 'eagle-settings-section-header' });
		const copyEl = headerEl.createDiv({ cls: 'eagle-settings-section-copy' });
		copyEl.createEl('h3', { text: title });
		if (description) {
			copyEl.createEl('p', { text: description });
		}

		if (options.actionText && options.onAction) {
			const actionButton = headerEl.createEl('button', {
				cls: 'mod-cta eagle-settings-header-action',
				text: options.actionText,
				type: 'button',
			});
			actionButton.addEventListener('click', options.onAction);
		}

		return sectionEl.createDiv({ cls: 'eagle-settings-section-body' });
	}

	private createCard(parentEl: HTMLElement, title: string, description = '', className = ''): HTMLElement {
		const cardEl = parentEl.createDiv({
			cls: `eagle-settings-card ${className}`.trim(),
		});
		if (title || description) {
			const headerEl = cardEl.createDiv({ cls: 'eagle-settings-card-header' });
			if (title) {
				headerEl.createEl('h4', { text: title });
			}
			if (description) {
				headerEl.createEl('p', { text: description });
			}
		}
		return cardEl;
	}

	private async addProfile(): Promise<void> {
		if (this.plugin.settings.libraryProfiles.length >= MAX_LIBRARY_PROFILES) {
			new Notice(`Up to ${MAX_LIBRARY_PROFILES} library profiles are supported.`);
			return;
		}

		const profile = createEmptyLibraryProfile(this.plugin.settings.libraryProfiles.length);
		this.plugin.settings.libraryProfiles.push(profile);
		this.activeProfileId = profile.id;
		await this.plugin.refreshLibraryProfilesAndServers();
		this.display();
	}

	private async removeProfile(profileId: string): Promise<void> {
		const profileIndex = this.plugin.settings.libraryProfiles.findIndex((profile) => profile.id === profileId);
		if (profileIndex < 0) {
			return;
		}

		this.plugin.settings.libraryProfiles.splice(profileIndex, 1);
		const nextActiveProfile = this.plugin.settings.libraryProfiles[profileIndex]
			?? this.plugin.settings.libraryProfiles[profileIndex - 1]
			?? null;
		this.activeProfileId = nextActiveProfile?.id ?? null;
		await this.plugin.refreshLibraryProfilesAndServers();
		this.display();
	}

	private renderLibraryRoutingSettings(parentEl: HTMLElement, resolvedProfiles: ReturnType<typeof getResolvedLibraryProfiles>): void {
		new Setting(parentEl)
			.setName('Destination')
			.setDesc('For files dragged or pasted from outside Eagle.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('fixed', 'Fixed target')
					.addOption('askEveryTime', 'Ask every time')
					.setValue(this.plugin.settings.externalUploadMode)
					.onChange(async (value: ExternalUploadMode) => {
						this.plugin.settings.externalUploadMode = value;
						await this.plugin.refreshLibraryProfilesAndServers();
						this.display();
					});
			});

		if (this.plugin.settings.externalUploadMode === 'fixed') {
			new Setting(parentEl)
				.setName('Default library')
				.addDropdown((dropdown) => {
					for (const profile of resolvedProfiles) {
						dropdown.addOption(profile.id, `${profile.alias} (${profile.servePort})`);
					}

					const fallbackProfile = resolvedProfiles[0];
					const currentValue = this.plugin.settings.defaultUploadTargetId || fallbackProfile?.id || '';
					if (currentValue) {
						dropdown.setValue(currentValue);
					}

					dropdown.onChange(async (value) => {
						this.plugin.settings.defaultUploadTargetId = value;
						await this.plugin.refreshLibraryProfilesAndServers();
					});
				});
		}
	}

	private renderProfileList(parentEl: HTMLElement, resolvedProfiles: ReturnType<typeof getResolvedLibraryProfiles>): void {
		const profileIds = resolvedProfiles.map((profile) => profile.id);
		const activeProfileId = this.ensureActiveProfileId(profileIds);

		if (resolvedProfiles.length === 0) {
			const emptyEl = parentEl.createDiv({ cls: 'eagle-settings-empty-state' });
			emptyEl.createEl('h4', { text: 'No libraries yet' });
			emptyEl.createEl('p', {
				text: 'Add an Eagle library to start linking attachments.',
			});
			const addButton = emptyEl.createEl('button', {
				cls: 'mod-cta',
				text: 'Add library',
				type: 'button',
			});
			addButton.addEventListener('click', () => {
				void this.addProfile();
			});
			return;
		}

		const tabsEl = parentEl.createDiv({ cls: 'eagle-settings-profile-tabs' });

		for (const profile of resolvedProfiles) {
			const isActive = profile.id === activeProfileId;
			const buttonEl = tabsEl.createEl('button', {
				cls: `eagle-settings-profile-button ${isActive ? 'is-active' : ''}`,
				type: 'button',
			});
			buttonEl.createSpan({ cls: 'eagle-settings-profile-button-title', text: profile.alias });
			buttonEl.setAttribute('aria-pressed', String(isActive));
			buttonEl.createSpan({
				cls: 'eagle-settings-profile-pill',
				text: `Port ${profile.servePort}`,
			});
			buttonEl.addEventListener('click', () => {
				this.activeProfileId = profile.id;
				this.display();
			});
		}

		const activeProfile = resolvedProfiles.find((profile) => profile.id === activeProfileId) ?? resolvedProfiles[0];
		const detailEl = parentEl.createDiv({ cls: 'eagle-settings-profile-detail' });
		this.renderProfileDetail(detailEl, activeProfile);
	}

	private renderProfileDetail(parentEl: HTMLElement, profile: ReturnType<typeof getResolvedLibraryProfiles>[number]): void {
		const profileIndex = this.plugin.settings.libraryProfiles.findIndex((entry) => entry.id === profile.id);
		if (profileIndex < 0) {
			parentEl.createDiv({ cls: 'eagle-settings-empty-state', text: 'Selected profile not found.' });
			return;
		}

		const summaryCard = this.createCard(parentEl, '', '', 'eagle-settings-profile-summary');
		const summaryHeader = summaryCard.createDiv({ cls: 'eagle-settings-profile-summary-header' });
		const summaryCopy = summaryHeader.createDiv({ cls: 'eagle-settings-profile-summary-copy' });
		const status = summaryCopy.createDiv({ cls: 'eagle-settings-library-status' });
		setIcon(status.createSpan(), profile.resolvedPath ? 'folder-check' : 'folder-x');
		status.createSpan({ text: profile.resolvedPath ? 'Available on this device' : 'Library path not found' });
		status.toggleClass('is-missing', !profile.resolvedPath);
		if (profile.resolvedPath) setTooltip(status, profile.resolvedPath);
		const summaryActions = summaryHeader.createDiv({ cls: 'eagle-settings-profile-summary-actions' });
		const deleteButton = summaryActions.createEl('button', {
			cls: 'clickable-icon',
			type: 'button',
		});
		setIcon(deleteButton, 'trash-2');
		setTooltip(deleteButton, 'Remove library configuration');
		deleteButton.addEventListener('click', () => {
			void this.removeProfile(profile.id);
		});

		const basicCard = this.createCard(parentEl, 'Library details');
		new Setting(basicCard)
			.setName('Alias')
			.addText((text) => {
				text.setPlaceholder('Enter alias')
					.setValue(profile.alias)
					.onChange((value) => {
						this.plugin.settings.libraryProfiles[profileIndex].alias = value;
						this.queueLibraryProfileRefresh(true);
					});
			});

		new Setting(basicCard)
			.setName('Port')
			.setDesc('Keep this port stable to preserve existing links.')
			.addText((text) => {
				text.setPlaceholder('Enter port number')
					.setValue(String(profile.servePort))
					.onChange((value) => {
						const parsedPort = Number.parseInt(value, 10);
						this.plugin.settings.libraryProfiles[profileIndex].servePort = Number.isFinite(parsedPort)
							? parsedPort
							: profile.servePort;
						this.queueLibraryProfileRefresh(true);
					});
			});

		new Setting(basicCard)
			.setName('Upload folder ID')
			.setDesc('Optional. Leave blank to use the library root.')
			.addText((text) => {
				text.setPlaceholder('Enter folder ID')
					.setValue(profile.folderId || '')
					.onChange((value) => {
						this.plugin.settings.libraryProfiles[profileIndex].folderId = value.trim();
						this.queueLibraryProfileRefresh();
					});
			});

		const pathsCard = this.createCard(
			parentEl,
			'Library paths',
			'One path per device, all pointing to the same Eagle library.',
		);
		new Setting(pathsCard)
			.setName('Device paths')
			.addButton((button) => {
				button
					.setButtonText('Add path')
					.setCta()
					.onClick(async () => {
						this.plugin.settings.libraryProfiles[profileIndex].paths.push('');
						await this.plugin.refreshLibraryProfilesAndServers();
						this.display();
					});
			});

		if (profile.paths.length === 0) {
			pathsCard.createDiv({
				cls: 'eagle-settings-inline-empty',
				text: 'Add the path to your .library folder.',
			});
		}

		profile.paths.forEach((libraryPath, pathIndex) => {
			new Setting(pathsCard)
				.setClass('eagle-settings-path')
				.setName(`Path ${pathIndex + 1}`)
				.addText((text) => {
					text.setPlaceholder('Enter library path')
						.setValue(libraryPath)
						.onChange((value) => {
							this.plugin.settings.libraryProfiles[profileIndex].paths[pathIndex] = value;
							this.queueLibraryProfileRefresh(true);
						});
				})
				.addExtraButton((button) => {
					button
						.setIcon('cross')
						.setTooltip('Remove path')
						.onClick(async () => {
							this.plugin.settings.libraryProfiles[profileIndex].paths.splice(pathIndex, 1);
							await this.plugin.refreshLibraryProfilesAndServers();
							this.display();
						});
				});
		});
	}

	private renderLibrariesPage(parentEl: HTMLElement): void {
		const resolvedProfiles = getResolvedLibraryProfiles(this.plugin.settings);
		const profileSection = this.createSection(
			parentEl,
			'Libraries',
			'',
			{
				actionText: this.plugin.settings.libraryProfiles.length >= MAX_LIBRARY_PROFILES ? `Max ${MAX_LIBRARY_PROFILES}` : 'Add library',
				onAction: () => {
					void this.addProfile();
				},
			},
		);
		this.renderProfileList(profileSection, resolvedProfiles);
	}

	private renderUploadPage(parentEl: HTMLElement): void {
		const sectionEl = this.createSection(
			parentEl,
			'Upload',
			'',
		);
		const masterCard = this.createCard(sectionEl, '');
		new Setting(masterCard)
			.setName('Upload to Eagle')
			.setDesc('Upload external files when dragging or pasting.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.enabled)
					.onChange(async (value) => {
						this.plugin.settings.upload.enabled = value;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		const routingCard = this.createCard(sectionEl, 'Upload destination');
		this.renderLibraryRoutingSettings(routingCard, getResolvedLibraryProfiles(this.plugin.settings));

		const gridEl = sectionEl.createDiv({ cls: 'eagle-settings-grid' });
		const surfaceCard = this.createCard(gridEl, 'Upload from');
		new Setting(surfaceCard)
			.setName('Markdown')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.markdown)
					.onChange(async (value) => {
						this.plugin.settings.upload.markdown = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(surfaceCard)
			.setName('Canvas')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.canvas)
					.onChange(async (value) => {
						this.plugin.settings.upload.canvas = value;
						await this.plugin.saveSettings();
					});
			});

		const contentCard = this.createCard(gridEl, 'File types');
		new Setting(contentCard)
			.setName('Images')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.image)
					.onChange(async (value) => {
						this.plugin.settings.upload.image = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(contentCard)
			.setName('Videos')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.video)
					.onChange(async (value) => {
						this.plugin.settings.upload.video = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(contentCard)
			.setName('Web links')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.website)
					.onChange(async (value) => {
						this.plugin.settings.upload.website = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(contentCard)
			.setName('Other files')
			.setDesc('PDF, audio and other attachments.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.other)
					.onChange(async (value) => {
						this.plugin.settings.upload.other = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderViewerPage(parentEl: HTMLElement): void {
		const sectionEl = this.createSection(
			parentEl,
			'Display preferences',
			'',
		);
		const gridEl = sectionEl.createDiv({ cls: 'eagle-settings-grid' });

		const imageCard = this.createCard(gridEl, 'Images');
		new Setting(imageCard)
			.setName('Image size')
			.setDesc('Width in pixels. Leave blank for original size.')
			.addText((text) => {
				text.setPlaceholder('Enter image size')
					.setValue(this.plugin.settings.imageSize?.toString() || '')
					.onChange(async (value) => {
						this.plugin.settings.imageSize = value ? parseInt(value, 10) : undefined;
						await this.plugin.saveSettings();
					});
			});
		new Setting(imageCard)
			.setName('Click to view images')
			.setDesc('Click the right half of the image to view the image in detail.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.clickView)
					.onChange(async (value) => {
						this.plugin.settings.clickView = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(imageCard)
			.setName('Adaptive display ratio')
			.setDesc('Maximum preview size relative to the window.')
			.addSlider((slider) => {
				slider.setLimits(0.1, 1, 0.05);
				slider.setValue(this.plugin.settings.adaptiveRatio);
				slider.onChange(async (value) => {
					this.plugin.settings.adaptiveRatio = value;
					await this.plugin.saveSettings();
				});
				slider.setDynamicTooltip();
			});

		const openCard = this.createCard(gridEl, 'Open attachments');
		new Setting(openCard)
			.setName('Open in Obsidian')
			.setDesc('The Web Viewer core plugin must be enabled to use popup or pane modes.')
			.addDropdown((dropdown) => {
				dropdown.addOption('newPage', 'Open in new page')
					.addOption('popup', 'Open in popup')
					.addOption('rightPane', 'Open in right pane')
					.setValue(this.plugin.settings.openInObsidian || 'newPage')
					.onChange(async (value) => {
						this.plugin.settings.openInObsidian = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderSyncPage(parentEl: HTMLElement): void {
		const syncSection = this.createSection(
			parentEl,
			'Metadata sync',
			'',
		);

		const attachmentTagSyncPanel = syncSection.createDiv({ cls: 'eagle-tag-sync-panel' });
		attachmentTagSyncPanel.createEl('h3', { text: 'Attachment tag sync' });

		new Setting(attachmentTagSyncPanel)
			.setName('Sync direction')
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
				.setName('Replace Eagle tags')
				.setDesc('Overwrite existing Eagle tags with the page tags.')
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

		const obsidianLinkSyncPanel = syncSection.createDiv({ cls: 'eagle-obsidian-link-panel' });
		obsidianLinkSyncPanel.createEl('h3', { text: 'Obsidian link sync' });

		new Setting(obsidianLinkSyncPanel)
			.setName('Auto send page link to Eagle')
			.setDesc('Send a backlink for new attachments. Requires a YAML id on the page.')
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
			.addText((text) => {
				text.setPlaceholder('Enter Obsidian store ID')
					.setValue(this.plugin.settings.obsidianStoreId)
					.onChange(async (value) => {
						this.plugin.settings.obsidianStoreId = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderAdvancedPage(parentEl: HTMLElement): void {
		const resolvedProfiles = getResolvedLibraryProfiles(this.plugin.settings);
		const activeServerCount = resolvedProfiles.filter((profile) => profile.resolvedPath).length;

		const sectionEl = this.createSection(
			parentEl,
			'Maintenance',
			'',
		);
		const cardEl = this.createCard(sectionEl, 'Local preview');
		cardEl.createDiv({
			cls: 'eagle-settings-inline-note',
			text: `Libraries available on this device: ${activeServerCount}`,
		});

		new Setting(cardEl)
			.setName('Refresh servers')
			.addButton((button) => {
				button
					.setButtonText('Refresh now')
					.setCta()
					.onClick(async () => {
						await this.plugin.refreshLibraryProfilesAndServers();
						new Notice('Eagle preview servers refreshed.');
					});
			});

		new Setting(cardEl)
			.setName('Debug mode')
			.setDesc('Write diagnostic messages to the developer console.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.debug)
					.onChange(async (value) => {
						this.plugin.settings.debug = value;
						await this.plugin.saveSettings();
					});
			});
	}

	display(): void {
		const contentEl = this.createShell(this.containerEl);

		switch (this.activePage) {
			case 'libraries':
				this.renderLibrariesPage(contentEl);
				break;
			case 'upload':
				this.renderUploadPage(contentEl);
				break;
			case 'viewer':
				this.renderViewerPage(contentEl);
				break;
			case 'sync':
				this.renderSyncPage(contentEl);
				break;
			case 'advanced':
				this.renderAdvancedPage(contentEl);
				break;
			default:
				this.renderLibrariesPage(contentEl);
				break;
		}
	}
}
