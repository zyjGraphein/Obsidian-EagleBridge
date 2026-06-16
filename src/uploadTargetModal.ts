import { Menu } from 'obsidian';
import type MyPlugin from './main';
import type { ResolvedEagleLibraryProfile } from './libraryProfiles';

export interface UploadTargetMenuAnchor {
	x: number;
	y: number;
	document?: Document;
}

export type UploadTargetMenuSelection = ResolvedEagleLibraryProfile | 'obsidian-default' | null;

interface ChooseUploadTargetOptions {
	allowObsidianDefault?: boolean;
	anchor?: UploadTargetMenuAnchor | null;
}

function resolveMenuAnchor(anchor?: UploadTargetMenuAnchor | null): Required<UploadTargetMenuAnchor> {
	const documentRef = anchor?.document ?? window.document;
	const view = documentRef.defaultView ?? window;
	return {
		x: anchor?.x ?? Math.round(view.innerWidth / 2),
		y: anchor?.y ?? Math.round(view.innerHeight / 2),
		document: documentRef,
	};
}

export function chooseUploadTargetProfile(
	_plugin: MyPlugin,
	profiles: ResolvedEagleLibraryProfile[],
	options: ChooseUploadTargetOptions = {},
): Promise<UploadTargetMenuSelection> {
	return new Promise((resolve) => {
		const menu = new Menu();
		const anchor = resolveMenuAnchor(options.anchor);
		let didResolve = false;

		const finish = (selection: UploadTargetMenuSelection): void => {
			if (didResolve) {
				return;
			}

			didResolve = true;
			resolve(selection);
			menu.hide();
		};

		for (const profile of profiles) {
			menu.addItem((item) => item
				.setIcon('folder-root')
				.setTitle(`${profile.alias} (${profile.servePort})`)
				.onClick(() => {
					finish(profile);
				}));
		}

		if (options.allowObsidianDefault) {
			menu.addSeparator();
			menu.addItem((item) => item
				.setIcon('image')
				.setTitle('Obsidian 默认嵌入')
				.onClick(() => {
					finish('obsidian-default');
				}));
		}

		menu.addSeparator();
		menu.addItem((item) => item
			.setIcon('x')
			.setTitle('取消')
			.onClick(() => {
				finish(null);
			}));

		menu.onHide(() => {
			if (!didResolve) {
				finish(null);
			}
		});

		menu.showAtPosition({ x: anchor.x, y: anchor.y }, anchor.document);
	});
}
