import MyPlugin from './main';
import { syncTags } from "./synchronizedpagetabs";
import { jumpModal } from "./eaglejumpobsidian";

export const addCommandSynchronizedPageTabs = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: "synchronized-page-tabs",
		name: "synchronized-page-tabs",
		callback: async () => {
			syncTags(myPlugin.app, myPlugin.settings);
		},
	});
};

export const addCommandEagleJump = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: "eagle-jump-obsidian",
		name: "eagle-jump-obsidian",
		callback: async () => {
			jumpModal(myPlugin.app, myPlugin.settings);
		},
	});
};