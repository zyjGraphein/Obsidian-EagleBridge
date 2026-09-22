import * as fs from 'fs';
import * as path from 'path';
import { TFile, type App, type TAbstractFile } from 'obsidian';
import type MyPlugin from './main';
import type { ResolvedEagleLink } from './urlHandler';
import { findLibraryProfileByPort, extractEagleLinkTarget } from './libraryProfiles';
import { resolveEagleItemById } from './eagleItemResolver';
import { isSameFileSystemPath } from './eaglePaths';

// Uploads can take minutes. References checked before the copy may change meanwhile.
export function trackAttachmentReferenceChanges(plugin: MyPlugin) {
    const app: App = plugin.app;
    let changed = false;
    let writingFile: TFile | null = null;
    const onChange = (file: TAbstractFile) => {
        if (file === writingFile) return;
        if (!(file instanceof TFile) || ['md', 'canvas', 'base'].includes(file.extension)) changed = true;
    };
    const events = [
        app.vault.on('modify', onChange), app.vault.on('create', onChange),
        app.vault.on('delete', onChange), app.vault.on('rename', onChange),
    ];
    for (const event of events) plugin.registerEvent(event);
    return {
        hasChanged: () => changed,
        setWritingFile: (file: TFile | null) => { writingFile = file; },
        dispose: () => events.forEach(event => app.vault.offref(event)),
    };
}

export async function verifyImportedAttachment(
    plugin: MyPlugin,
    sourcePath: string,
    originalStats: { size: number; mtimeMs: number },
    link: ResolvedEagleLink,
): Promise<string | null> {
    try {
        const target = extractEagleLinkTarget(link.url);
        const profile = target ? findLibraryProfileByPort(plugin.settings, target.port) : null;
        if (!profile || !target) return '暂时无法核对 Eagle 副本，已保留源附件。';
        // The API can return before metadata is flushed. Only deletion waits for
        // this one item's copy; the Markdown link has already been written.
        for (let attempt = 0; attempt < 20; attempt++) {
            const imported = await resolveEagleItemById(profile.resolvedPath, target.itemId).catch(() => null);
            const currentStats = await fs.promises.stat(sourcePath);
            if (currentStats.size !== originalStats.size || currentStats.mtimeMs !== originalStats.mtimeMs) {
                return '源附件在上传期间已改变，已保留。';
            }
            if (imported?.sourceFilePath && path.extname(imported.sourceFilePath).toLowerCase() === path.extname(sourcePath).toLowerCase()) {
                if (isSameFileSystemPath(sourcePath, imported.sourceFilePath)) return '源附件与 Eagle 文件相同，已跳过删除。';
                const importedStats = await fs.promises.stat(imported.sourceFilePath).catch(() => null);
                if (importedStats?.isFile() && importedStats.size === originalStats.size) return null;
            }
            if (attempt < 19) await new Promise(resolve => setTimeout(resolve, 250));
        }
        return 'Eagle 副本尚未就绪或文件大小不一致，已保留源附件。';
    } catch {
        return '无法读取源附件或 Eagle 副本，已保留源附件。';
    }
}
