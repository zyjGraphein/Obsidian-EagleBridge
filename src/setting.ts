import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
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
					this.display();
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

		const navEl = shellEl.createEl('nav', {
			cls: 'eagle-settings-nav',
			attr: {
				role: 'tablist',
				'aria-orientation': 'horizontal',
			},
		});
		this.createPageButton(navEl, 'libraries', 'Libraries');
		this.createPageButton(navEl, 'upload', 'Upload');
		this.createPageButton(navEl, 'viewer', 'Viewer');
		this.createPageButton(navEl, 'sync', 'Sync');
		this.createPageButton(navEl, 'advanced', 'Advanced');

		return shellEl.createDiv({ cls: 'eagle-settings-content' });
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
			.setName('Mode')
			.setDesc('Choose a fixed library or pick one each time for files outside all configured libraries.')
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
				.setDesc('External files upload here automatically.')
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
			emptyEl.createEl('h4', { text: 'No library profile yet' });
			emptyEl.createEl('p', {
				text: 'Create a profile for each real Eagle library. Different machine paths to the same library should stay in the same profile.',
			});
			const addButton = emptyEl.createEl('button', {
				cls: 'mod-cta',
				text: 'Add first profile',
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
		summaryCopy.createEl('h3', { text: profile.alias });
		summaryCopy.createEl('p', {
			text: 'One profile represents one Eagle library.',
		});
		const summaryActions = summaryHeader.createDiv({ cls: 'eagle-settings-profile-summary-actions' });
		const deleteButton = summaryActions.createEl('button', {
			cls: 'mod-warning',
			text: 'Delete profile',
			type: 'button',
		});
		deleteButton.addEventListener('click', () => {
			void this.removeProfile(profile.id);
		});

		const metaGrid = summaryCard.createDiv({ cls: 'eagle-settings-profile-meta-grid' });
		this.createMetaItem(metaGrid, 'Port', String(profile.servePort));
		this.createMetaItem(metaGrid, 'Folder ID', profile.folderId || 'Not set');
		this.createMetaItem(metaGrid, 'Current valid path', profile.resolvedPath || 'None on this device');

		const basicCard = this.createCard(parentEl, 'Profile details', 'Core settings for this library.');
		new Setting(basicCard)
			.setName('Alias')
			.setDesc('Display name for this profile.')
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
			.setDesc('Local preview port for this library.')
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
			.setName('Folder ID')
			.setDesc('Default Eagle folder for uploads to this profile.')
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
			'Path aliases',
			'Add one path per computer. Every path here must point to the same library.',
		);
		new Setting(pathsCard)
			.setName('Library paths')
			.setDesc('The first existing path on this device becomes the active path.')
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
				text: 'No path alias yet. Add at least one path for this library.',
			});
		}

		profile.paths.forEach((libraryPath, pathIndex) => {
			new Setting(pathsCard)
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

	private createMetaItem(parentEl: HTMLElement, label: string, value: string): void {
		const itemEl = parentEl.createDiv({ cls: 'eagle-settings-meta-item' });
		itemEl.createDiv({ cls: 'eagle-settings-meta-label', text: label });
		itemEl.createDiv({ cls: 'eagle-settings-meta-value', text: value });
	}

	private renderLibrariesPage(parentEl: HTMLElement): void {
		const resolvedProfiles = getResolvedLibraryProfiles(this.plugin.settings);
		const routingSection = this.createSection(
			parentEl,
			'Upload target',
			'Choose where files outside all configured libraries should upload.',
		);
		this.renderLibraryRoutingSettings(routingSection, resolvedProfiles);

		const profileSection = this.createSection(
			parentEl,
			'Library profiles',
			'Create one profile per Eagle library.',
			{
				actionText: this.plugin.settings.libraryProfiles.length >= MAX_LIBRARY_PROFILES ? `Max ${MAX_LIBRARY_PROFILES}` : 'Add profile',
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
			'Set the main switch, supported surfaces, and allowed content types.',
		);
		const masterCard = this.createCard(sectionEl, 'Master switch', 'Main control for all external Eagle uploads.');
		new Setting(masterCard)
			.setName('Attachment upload')
			.setDesc('Enable Eagle upload for external drag and paste.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.enabled)
					.onChange(async (value) => {
						this.plugin.settings.upload.enabled = value;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		const gridEl = sectionEl.createDiv({ cls: 'eagle-settings-grid' });
		const surfaceCard = this.createCard(gridEl, 'Obsidian surface', 'Choose which surfaces can trigger uploads.');
		new Setting(surfaceCard)
			.setName('Markdown upload')
			.setDesc('Handle paste and drag inside Markdown editors.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.markdown)
					.onChange(async (value) => {
						this.plugin.settings.upload.markdown = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(surfaceCard)
			.setName('Canvas upload')
			.setDesc('Handle paste and drag inside Canvas views.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.canvas)
					.onChange(async (value) => {
						this.plugin.settings.upload.canvas = value;
						await this.plugin.saveSettings();
					});
			});

		const contentCard = this.createCard(gridEl, 'Content type', 'Choose which content types can upload.');
		new Setting(contentCard)
			.setName('Image upload')
			.setDesc('Upload image files.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.image)
					.onChange(async (value) => {
						this.plugin.settings.upload.image = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(contentCard)
			.setName('Video upload')
			.setDesc('Upload video files.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.video)
					.onChange(async (value) => {
						this.plugin.settings.upload.video = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(contentCard)
			.setName('Website upload')
			.setDesc('Upload website URLs.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.website)
					.onChange(async (value) => {
						this.plugin.settings.upload.website = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(contentCard)
			.setName('Other upload')
			.setDesc('Upload PDF and other files.')
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
			'Fine-tune image sizing, click behavior, and how previews open in Obsidian.',
		);
		const gridEl = sectionEl.createDiv({ cls: 'eagle-settings-grid' });

		const imageCard = this.createCard(gridEl, 'Image display', 'Default image size and click behavior.');
		new Setting(imageCard)
			.setName('Image size')
			.setDesc('Default size for image import.')
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
			.setDesc('When the image exceeds the window size, display it adaptively according to the current window.')
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

		const openCard = this.createCard(gridEl, 'Open behavior', 'Choose where an Eagle attachment should open inside Obsidian.');
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
			'These settings stay grouped here so tag sync and page backlink sync are easier to reason about.',
		);

		const attachmentTagSyncPanel = syncSection.createDiv({ cls: 'eagle-tag-sync-panel' });
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

		const obsidianLinkSyncPanel = syncSection.createDiv({ cls: 'eagle-obsidian-link-panel' });
		obsidianLinkSyncPanel.createEl('h3', { text: 'Obsidian link sync' });
		obsidianLinkSyncPanel.createEl('p', {
			text: 'Send the current page advanced URI to Eagle. Automatic mode only runs when new Eagle attachments appear in a page that already has YAML id.',
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
			'Refresh preview servers after path changes and enable debug logging only when needed.',
		);
		const cardEl = this.createCard(sectionEl, 'Preview server tools', 'Active preview servers come from profiles with a valid local path.');
		cardEl.createDiv({
			cls: 'eagle-settings-inline-note',
			text: `Active preview servers on this device: ${activeServerCount}`,
		});

		new Setting(cardEl)
			.setName('Refresh servers')
			.setDesc('Refresh all active local preview servers with the current profile settings.')
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
			.setDesc('Enable or disable debug logging.')
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
