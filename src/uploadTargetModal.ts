import { Modal } from 'obsidian';
import type MyPlugin from './main';
import type { ResolvedEagleLibraryProfile } from './libraryProfiles';

class UploadTargetModal extends Modal {
	private readonly profiles: ResolvedEagleLibraryProfile[];
	private readonly resolveSelection: (profile: ResolvedEagleLibraryProfile | null) => void;
	private didResolve = false;

	constructor(
		plugin: MyPlugin,
		profiles: ResolvedEagleLibraryProfile[],
		resolveSelection: (profile: ResolvedEagleLibraryProfile | null) => void,
	) {
		super(plugin.app);
		this.profiles = profiles;
		this.resolveSelection = resolveSelection;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Choose Eagle library' });
		contentEl.createEl('p', {
			text: 'Select which library should receive this external upload.',
		});

		for (const profile of this.profiles) {
			const button = contentEl.createEl('button', {
				text: `${profile.alias} (${profile.servePort})`,
				cls: 'mod-cta',
			});
			button.style.display = 'block';
			button.style.width = '100%';
			button.style.marginBottom = '8px';
			button.addEventListener('click', () => {
				this.finish(profile);
			});

			contentEl.createEl('div', {
				text: profile.resolvedPath,
				cls: 'setting-item-description',
			});
		}

		const cancelButton = contentEl.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.finish(null));
	}

	onClose(): void {
		if (!this.didResolve) {
			this.finish(null);
		}
	}

	private finish(profile: ResolvedEagleLibraryProfile | null): void {
		if (this.didResolve) {
			return;
		}

		this.didResolve = true;
		this.resolveSelection(profile);
		this.close();
	}
}

export function chooseUploadTargetProfile(
	plugin: MyPlugin,
	profiles: ResolvedEagleLibraryProfile[],
): Promise<ResolvedEagleLibraryProfile | null> {
	return new Promise((resolve) => {
		new UploadTargetModal(plugin, profiles, resolve).open();
	});
}
