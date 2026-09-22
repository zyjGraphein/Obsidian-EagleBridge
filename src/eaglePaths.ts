import * as path from 'path';
import * as fs from 'fs';

export function isSameFileSystemPath(left: string, right: string): boolean {
    if (toComparablePath(left) === toComparablePath(right)) {
        return true;
    }
    try {
        const leftStat = fs.statSync(left, { bigint: true });
        const rightStat = fs.statSync(right, { bigint: true });
        // Directory identity also handles aliases, macOS casing and Unicode variants.
        return leftStat.ino !== BigInt(0) && leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
    } catch {
        return false;
    }
}

function toComparablePath(targetPath: string): string {
    const resolvedPath = path.resolve(targetPath);
    return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

export function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
    if (!targetPath || !directoryPath) {
        return false;
    }

    const comparableTargetPath = toComparablePath(targetPath);
    const comparableDirectoryPath = toComparablePath(directoryPath);
    const relativePath = path.relative(comparableDirectoryPath, comparableTargetPath);

    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function getEagleLibraryItemPath(targetPath: string, libraryPath: string): string | null {
    const item = getEagleItemPathLocation(targetPath);
    if (!item || !isSameFileSystemPath(item.libraryPath, libraryPath)) {
        return null;
    }
    return path.posix.join('images', item.infoDirectoryName);
}

export function getEagleItemPathLocation(targetPath: string): { libraryPath: string; infoDirectoryName: string } | null {
    let directory = path.dirname(path.resolve(targetPath));
    while (directory !== path.dirname(directory)) {
        const parent = path.dirname(directory);
        if (/^[^/\\]+\.info$/i.test(path.basename(directory)) && path.basename(parent).toLowerCase() === 'images') {
            return { libraryPath: path.dirname(parent), infoDirectoryName: path.basename(directory) };
        }
        directory = parent;
    }
    return null;
}
