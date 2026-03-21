import MyPlugin from './main';
import { syncCurrentPageTags } from "./synchronizedpagetabs";
import { syncCurrentPageObsidianLinkToEagle } from './obsidianLinkSync';
import { uploadCurrentMarkdownAttachmentsToEagle } from './markdownAttachmentBatchUpload';

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

export const addCommandUploadCurrentMarkdownAttachments = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: 'upload-current-markdown-attachments-to-eagle',
		name: 'Upload current Markdown attachments to Eagle',
		checkCallback: (checking: boolean) => {
			const activeFile = myPlugin.app.workspace.getActiveFile();
			const canRun = activeFile?.extension === 'md';
			if (!canRun) {
				return false;
			}

			if (!checking) {
				void uploadCurrentMarkdownAttachmentsToEagle(myPlugin);
			}

			return true;
		},
	});
};
