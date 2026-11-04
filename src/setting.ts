import { App, PluginSettingTab, Notice, setIcon, setTooltip } from 'obsidian';
import MyPlugin from './main';
import { appendEagleBridgeLogo } from './branding';
import { createEmptyLibraryProfile, getResolvedLibraryProfiles, MAX_LIBRARY_PROFILES } from './libraryProfiles';
import { EBSetting, ebT, normalizeUiLang, type UiLang } from './i18n';
import {
	normalizeFileNameMode,
	normalizeImageSizeMode,
	normalizeMultiInsertSeparator,
	normalizeSquareAlign,
	type FileNameMode,
	type ImageSizeMode,
	type MultiInsertSeparator,
	type SquareAlign,
} from './embedFormat';

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
	imageSizeMode?: ImageSizeMode;
	squareSize?: number;
	landscapeRatio?: number;
	portraitRatio?: number;
	landscapeWidth?: number;
	portraitWidth?: number;
	squareAlign?: SquareAlign;
	fileNameMode?: FileNameMode;
	fileNameCustom?: string;
	multiInsertSeparator?: MultiInsertSeparator;
	uiLang?: UiLang;
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
	imageSizeMode: 'fixed',
	squareSize: 300,
	landscapeRatio: 1.6,
	portraitRatio: 1,
	landscapeWidth: 640,
	portraitWidth: 400,
	squareAlign: 'portrait',
	fileNameMode: 'strip',
	fileNameCustom: '',
	multiInsertSeparator: 'none',
	uiLang: 'en',
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
		const headerEl = shellEl.createDiv({ cls: 'eagle-settings-header' });
		appendEagleBridgeLogo(headerEl);
		headerEl.createEl('h2', { text: 'EagleBridge', cls: 'eagle-settings-title' });
		headerEl.createSpan({
			text: `v${this.plugin.manifest.version}`,
			cls: 'eagle-settings-version',
		});

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
		const pageLabel = ebT(title, this.plugin.settings);
		buttonEl.setText(normalizeUiLang(this.plugin.settings.uiLang) === 'zh' ? `${pageLabel}设置` : pageLabel);
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
		copyEl.createEl('h3', { text: ebT(title, this.plugin.settings) });
		if (description) {
			copyEl.createEl('p', { text: ebT(description, this.plugin.settings) });
		}

		if (options.actionText && options.onAction) {
			const actionButton = headerEl.createEl('button', {
				cls: 'mod-cta eagle-settings-header-action',
				text: ebT(options.actionText, this.plugin.settings),
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
				headerEl.createEl('h4', { text: ebT(title, this.plugin.settings) });
			}
			if (description) {
				headerEl.createEl('p', { text: ebT(description, this.plugin.settings) });
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
		new EBSetting(parentEl, this.plugin.settings)
			.setName('Destination')
			.setDesc('For files dragged or pasted from outside Eagle.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('fixed', ebT('Fixed target', this.plugin.settings))
					.addOption('askEveryTime', ebT('Ask every time', this.plugin.settings))
					.setValue(this.plugin.settings.externalUploadMode)
					.onChange(async (value: ExternalUploadMode) => {
						this.plugin.settings.externalUploadMode = value;
						await this.plugin.refreshLibraryProfilesAndServers();
						this.display();
					});
			});

		if (this.plugin.settings.externalUploadMode === 'fixed') {
			new EBSetting(parentEl, this.plugin.settings)
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
		new EBSetting(basicCard, this.plugin.settings)
			.setName('Alias')
			.addText((text) => {
				text.setPlaceholder(ebT('Enter alias', this.plugin.settings))
					.setValue(profile.alias)
					.onChange((value) => {
						this.plugin.settings.libraryProfiles[profileIndex].alias = value;
						this.queueLibraryProfileRefresh(true);
					});
			});

		new EBSetting(basicCard, this.plugin.settings)
			.setName('Port')
			.setDesc('Keep this port stable to preserve existing links.')
			.addText((text) => {
				text.setPlaceholder(ebT('Enter port number', this.plugin.settings))
					.setValue(String(profile.servePort))
					.onChange((value) => {
						const parsedPort = Number.parseInt(value, 10);
						this.plugin.settings.libraryProfiles[profileIndex].servePort = Number.isFinite(parsedPort)
							? parsedPort
							: profile.servePort;
						this.queueLibraryProfileRefresh(true);
					});
			});

		new EBSetting(basicCard, this.plugin.settings)
			.setName('Upload folder ID')
			.setDesc('Optional. Leave blank to use the library root.')
			.addText((text) => {
				text.setPlaceholder(ebT('Enter folder ID', this.plugin.settings))
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
		new EBSetting(pathsCard, this.plugin.settings)
			.setName('Device paths')
			.addButton((button) => {
				button
					.setButtonText(ebT('Add path', this.plugin.settings))
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
			new EBSetting(pathsCard, this.plugin.settings)
				.setClass('eagle-settings-path')
				.setName(`Path ${pathIndex + 1}`)
				.addText((text) => {
					text.setPlaceholder(ebT('Enter library path', this.plugin.settings))
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
		const langSection = this.createSection(parentEl, 'Interface language', '');
		const langCard = this.createCard(langSection, '');
		new EBSetting(langCard, this.plugin.settings)
			.setName('Interface language')
			.setDesc('Switch the language of these settings. Applies to this settings panel.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('zh', '中文')
					.addOption('en', 'English')
					.setValue(normalizeUiLang(this.plugin.settings.uiLang))
					.onChange(async (value: string) => {
						this.plugin.settings.uiLang = normalizeUiLang(value);
						await this.plugin.saveSettings();
						this.display();
					});
			});

		const resolvedProfiles = getResolvedLibraryProfiles(this.plugin.settings);
		const profileSection = this.createSection(
			parentEl,
			'Library list',
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
			'Image upload',
			'',
		);
		const masterCard = this.createCard(sectionEl, '');
		new EBSetting(masterCard, this.plugin.settings)
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

		const nameCard = this.createCard(
			sectionEl,
			'Image file name',
			'Avoid symbols such as [ ] in source file names clashing with Obsidian syntax. File names are cleaned by default; you can define your own rule.',
		);
		new EBSetting(nameCard, this.plugin.settings)
			.setName('Naming mode')
			.setDesc('Strip: remove [ ] ( ) | < >\nReplace: swap them to full-width\nNumbered: note title + index\nCustom: your own rules')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('strip', ebT('Strip dangerous characters (default)', this.plugin.settings))
					.addOption('replace', ebT('Replace with full-width 【】（etc.)', this.plugin.settings))
					.addOption('numbered', ebT('Note title - index', this.plugin.settings))
					.addOption('custom', ebT('Custom rules', this.plugin.settings))
					.setValue(normalizeFileNameMode(this.plugin.settings.fileNameMode))
					.onChange(async (value: string) => {
						this.plugin.settings.fileNameMode = normalizeFileNameMode(value);
						await this.plugin.saveSettings();
						this.display();
					});
			});
		if (normalizeFileNameMode(this.plugin.settings.fileNameMode) === 'custom') {
			// 与「覆盖 Eagle 标签」一致：用缩进 + 左侧竖线表示这是上一项的从属设置
			const customWrapEl = nameCard.createDiv({ cls: 'eagle-settings-subitem' });
			new EBSetting(customWrapEl, this.plugin.settings)
				.setName('Custom rules')
				.setDesc('Format: from=>to, comma-separated.')
				.addText((text) => {
					text.setPlaceholder('[=>【,]=>】')
						.setValue(this.plugin.settings.fileNameCustom ?? '')
						.onChange(async (value) => {
							this.plugin.settings.fileNameCustom = value;
							await this.plugin.saveSettings();
						});
				});
		}

		const gridEl = sectionEl.createDiv({ cls: 'eagle-settings-grid' });
		const surfaceCard = this.createCard(gridEl, 'Upload from');
		new EBSetting(surfaceCard, this.plugin.settings)
			.setName('Markdown')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.markdown)
					.onChange(async (value) => {
						this.plugin.settings.upload.markdown = value;
						await this.plugin.saveSettings();
					});
			});
		new EBSetting(surfaceCard, this.plugin.settings)
			.setName('Canvas')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.canvas)
					.onChange(async (value) => {
						this.plugin.settings.upload.canvas = value;
						await this.plugin.saveSettings();
					});
			});

		const contentCard = this.createCard(gridEl, 'File types');
		new EBSetting(contentCard, this.plugin.settings)
			.setName('Images')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.image)
					.onChange(async (value) => {
						this.plugin.settings.upload.image = value;
						await this.plugin.saveSettings();
					});
			});
		new EBSetting(contentCard, this.plugin.settings)
			.setName('Videos')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.video)
					.onChange(async (value) => {
						this.plugin.settings.upload.video = value;
						await this.plugin.saveSettings();
					});
			});
		new EBSetting(contentCard, this.plugin.settings)
			.setName('Web links')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.website)
					.onChange(async (value) => {
						this.plugin.settings.upload.website = value;
						await this.plugin.saveSettings();
					});
			});
		new EBSetting(contentCard, this.plugin.settings)
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

		const insertCard = this.createCard(
			gridEl,
			'Image insertion',
			'Only the initial width written into the note when you drag or paste an image. Change it later by editing the number after | in the note.',
		);
		new EBSetting(insertCard, this.plugin.settings)
			.setName('Size mode')
			.setDesc('Size mode: Square as base uses one square width, landscape and portrait scale from it.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('fixed', ebT('Fixed size', this.plugin.settings))
					.addOption('ratio', ebT('Square as base × ratios', this.plugin.settings))
					.addOption('explicit', ebT('Explicit landscape / portrait width', this.plugin.settings))
					.setValue(normalizeImageSizeMode(this.plugin.settings.imageSizeMode))
					.onChange(async (value: string) => {
						this.plugin.settings.imageSizeMode = normalizeImageSizeMode(value);
						await this.plugin.saveSettings();
						this.display();
					});
			});

		const sizeMode = normalizeImageSizeMode(this.plugin.settings.imageSizeMode);
		if (sizeMode === 'fixed') {
			new EBSetting(insertCard, this.plugin.settings)
				.setName('Fixed width')
				.setDesc('Every image uses this width. Leave blank to keep the original size.')
				.addText((text) => {
					text.setPlaceholder('300')
						.setValue(this.plugin.settings.imageSize != null ? String(this.plugin.settings.imageSize) : '')
						.onChange(async (value) => {
							this.plugin.settings.imageSize = value ? parseInt(value, 10) : undefined;
							await this.plugin.saveSettings();
						});
				});
		} else if (sizeMode === 'explicit') {
			new EBSetting(insertCard, this.plugin.settings)
				.setName('Landscape width')
				.setDesc('Width in pixels for landscape images.')
				.addText((text) => {
					text.setPlaceholder('640')
						.setValue(this.plugin.settings.landscapeWidth != null ? String(this.plugin.settings.landscapeWidth) : '')
						.onChange(async (value) => {
							const parsed = parseInt(value, 10);
							this.plugin.settings.landscapeWidth = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
							await this.plugin.saveSettings();
						});
				});
			new EBSetting(insertCard, this.plugin.settings)
				.setName('Portrait width')
				.setDesc('Width in pixels for portrait images.')
				.addText((text) => {
					text.setPlaceholder('400')
						.setValue(this.plugin.settings.portraitWidth != null ? String(this.plugin.settings.portraitWidth) : '')
						.onChange(async (value) => {
							const parsed = parseInt(value, 10);
							this.plugin.settings.portraitWidth = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
							await this.plugin.saveSettings();
						});
				});
			new EBSetting(insertCard, this.plugin.settings)
				.setName('Square aligns to')
				.setDesc('Near-square images follow one of the two widths above.')
				.addDropdown((dropdown) => {
					dropdown
						.addOption('portrait', ebT('Portrait', this.plugin.settings))
						.addOption('landscape', ebT('Landscape', this.plugin.settings))
						.setValue(normalizeSquareAlign(this.plugin.settings.squareAlign))
						.onChange(async (value: string) => {
							this.plugin.settings.squareAlign = normalizeSquareAlign(value);
							await this.plugin.saveSettings();
						});
				});
		} else {
			new EBSetting(insertCard, this.plugin.settings)
				.setName('Square base width')
				.setDesc('Width for near-square images. Leave blank to keep the original size.')
				.addText((text) => {
					text.setPlaceholder('300')
						.setValue(this.plugin.settings.squareSize != null ? String(this.plugin.settings.squareSize) : '')
						.onChange(async (value) => {
							const parsed = parseInt(value, 10);
							this.plugin.settings.squareSize = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
							await this.plugin.saveSettings();
						});
				});
			new EBSetting(insertCard, this.plugin.settings)
				.setName('Landscape ratio')
				.setDesc('Landscape width = square base × this value.')
				.addText((text) => {
					text.setPlaceholder('1.6')
						.setValue(this.plugin.settings.landscapeRatio != null ? String(this.plugin.settings.landscapeRatio) : '')
						.onChange(async (value) => {
							const parsed = parseFloat(value);
							this.plugin.settings.landscapeRatio = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
							await this.plugin.saveSettings();
						});
				});
			new EBSetting(insertCard, this.plugin.settings)
				.setName('Portrait ratio')
				.setDesc('Portrait width = square base × this value. Default 1.')
				.addText((text) => {
					text.setPlaceholder('1')
						.setValue(this.plugin.settings.portraitRatio != null ? String(this.plugin.settings.portraitRatio) : '')
						.onChange(async (value) => {
							const parsed = parseFloat(value);
							this.plugin.settings.portraitRatio = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
							await this.plugin.saveSettings();
						});
				});
		}

		new EBSetting(insertCard, this.plugin.settings)
			.setName('Multi-image separator')
			.setDesc('How to join the images when several are dragged or pasted at once.\nSide by side: written on the same line, so they flow into one row.\nSame line with a space: one extra gap between them.\nOne per line: each image own its own line.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('none', ebT('Side by side (same line)', this.plugin.settings))
					.addOption('space', ebT('Same line with a space', this.plugin.settings))
					.addOption('newline', ebT('One per line', this.plugin.settings))
					.setValue(normalizeMultiInsertSeparator(this.plugin.settings.multiInsertSeparator))
					.onChange(async (value: string) => {
						this.plugin.settings.multiInsertSeparator = normalizeMultiInsertSeparator(value);
						await this.plugin.saveSettings();
					});
			});

		const imageCard = this.createCard(gridEl, 'Images');
		new EBSetting(imageCard, this.plugin.settings)
			.setName('Click to view images')
			.setDesc('Click the right half of the image to view the image in detail.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.clickView)
					.onChange(async (value) => {
						this.plugin.settings.clickView = value;
						await this.plugin.saveSettings();
					});
			});
		new EBSetting(imageCard, this.plugin.settings)
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
		new EBSetting(openCard, this.plugin.settings)
			.setName('Open in Obsidian')
			.setDesc('The Web Viewer core plugin must be enabled to use popup or pane modes.')
			.addDropdown((dropdown) => {
				dropdown.addOption('newPage', ebT('Open in new page', this.plugin.settings))
					.addOption('popup', ebT('Open in popup', this.plugin.settings))
					.addOption('rightPane', ebT('Open in right pane', this.plugin.settings))
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
		attachmentTagSyncPanel.createEl('h3', { text: ebT('Attachment tag sync', this.plugin.settings) });

		new EBSetting(attachmentTagSyncPanel, this.plugin.settings)
			.setName('Sync direction')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('off', ebT('Off', this.plugin.settings))
					.addOption('appendPageTagsToEagle', ebT('Append page tags to Eagle', this.plugin.settings))
					.addOption('importEagleTagsToYaml', ebT('Import Eagle tags to YAML', this.plugin.settings))
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
			new EBSetting(appendModeCard, this.plugin.settings)
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
		obsidianLinkSyncPanel.createEl('h3', { text: ebT('Obsidian link sync', this.plugin.settings) });

		new EBSetting(obsidianLinkSyncPanel, this.plugin.settings)
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

		new EBSetting(obsidianLinkSyncPanel, this.plugin.settings)
			.setName('Obsidian store ID')
			.setDesc('Vault identifier used in obsidian://adv-uri links.')
			.addText((text) => {
				text.setPlaceholder(ebT('Enter Obsidian store ID', this.plugin.settings))
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

		new EBSetting(cardEl, this.plugin.settings)
			.setName('Refresh servers')
			.addButton((button) => {
				button
					.setButtonText(ebT('Refresh now', this.plugin.settings))
					.setCta()
					.onClick(async () => {
						await this.plugin.refreshLibraryProfilesAndServers();
						new Notice('Eagle preview servers refreshed.');
					});
			});

		new EBSetting(cardEl, this.plugin.settings)
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
