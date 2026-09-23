import { addIcon, removeIcon } from 'obsidian';
import logoSvg from '../logo/OEbridge.svg';

export const EAGLEBRIDGE_ICON = 'eaglebridge-logo';
const logoUrl = `data:image/svg+xml,${encodeURIComponent(logoSvg)}`;

export function registerEagleBridgeIcon(): () => void {
	// Keep the original colors and isolate SVG gradient IDs between icon instances.
	addIcon(EAGLEBRIDGE_ICON, `<image href="${logoUrl}" width="100" height="100" />`);
	return () => removeIcon(EAGLEBRIDGE_ICON);
}

export function appendEagleBridgeLogo(parent: HTMLElement): void {
	parent.createEl('img', {
		cls: 'eagle-brand-logo',
		attr: { src: logoUrl, alt: '', 'aria-hidden': 'true', draggable: 'false' },
	});
}
