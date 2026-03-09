import MyPlugin from './main';
import { syncCurrentPageTags } from "./synchronizedpagetabs";
import { syncCurrentPageObsidianLinkToEagle } from './obsidianLinkSync';

export const addCommandSynchronizedPageTabs = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: "synchronized-page-tabs",
		name: "Append current page tags to Eagle",
		callback: async () => {
			await syncCurrentPageTags(myPlugin.app, myPlugin.settings, { notify: true });
		},
	});
};

export const addCommandSyncCurrentPageObsidianLink = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: "sync-current-page-obsidian-link-to-eagle",
		name: "Send current page Obsidian link to Eagle",
		callback: async () => {
			await syncCurrentPageObsidianLinkToEagle(myPlugin.app, myPlugin.settings);
		},
	});
};
