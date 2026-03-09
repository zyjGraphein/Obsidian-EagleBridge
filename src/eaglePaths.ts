import * as path from 'path';

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
    const resolvedLibraryImagesPath = path.join(path.resolve(libraryPath), 'images');
    const resolvedTargetPath = path.resolve(targetPath);

    if (!isPathInsideDirectory(resolvedTargetPath, resolvedLibraryImagesPath)) {
        return null;
    }

    const relativePath = path.relative(resolvedLibraryImagesPath, resolvedTargetPath);
    const pathSegments = relativePath.split(path.sep).filter(Boolean);

    if (pathSegments.length < 2) {
        return null;
    }

    const infoDirectoryName = pathSegments[0];
    if (!/\.info$/i.test(infoDirectoryName)) {
        return null;
    }

    return path.posix.join('images', infoDirectoryName);
}
