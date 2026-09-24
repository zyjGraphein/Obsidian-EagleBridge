const path = require('path');
const { getLibraryKey, probeServer } = require('./previewBridge');

function getItemContext(item) {
    if (!item || typeof item.id !== 'string' || !/^[a-z0-9_-]+$/i.test(item.id) || typeof item.metadataFilePath !== 'string' || !item.metadataFilePath) {
        throw new Error('Select an Eagle item first.');
    }
    const directory = path.dirname(item.metadataFilePath);
    const images = path.dirname(directory);
    if (path.basename(directory) !== `${item.id}.info` || path.basename(images) !== 'images') {
        throw new Error('Cannot locate this item’s Eagle library.');
    }
    return { id: item.id, libraryPath: path.dirname(images) };
}

function formatLink(item, port, format, width = '') {
    const { id } = getItemContext(item);
    if (format === 'id') return `${id}.info`;
    const url = `http://localhost:${port}/images/${id}.info`;
    const name = String(item.name || id).replace(/[\r\n]+/g, ' ');
    const extension = String(item.ext || '').replace(/^\./, '');
    const filename = extension && !name.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
        ? `${name}.${extension}` : name;
    const label = filename.replace(/[\\[\]*_`|<>]/g, '\\$&');
    switch (format) {
        case 'embed':
            if (width !== '' && !/^[1-9]\d{0,4}$/.test(String(width))) throw new Error('Enter a width from 1 to 99999, or leave it blank.');
            return `![${label}${width === '' ? '' : `|${width}`}](${url})`;
        case 'link': return `[${label}](${url})`;
        case 'url': return url;
        default: throw new Error('Choose a link format.');
    }
}

// Revalidate immediately before writing: a server can close or change libraries
// while the panel remains open. A failed check must leave the clipboard intact.
async function copyItemLink(item, service, format, width, clipboard) {
    if (format === 'id') {
        const text = formatLink(item, undefined, format);
        await clipboard.writeText(text);
        return text;
    }
    const { libraryPath } = getItemContext(item);
    if (!service) throw new Error('No preview service. Update and reload EagleBridge in all open Obsidian vaults, then retry.');
    const [libraryKey, info] = await Promise.all([getLibraryKey(libraryPath), probeServer(service.port)]);
    if (!info || libraryKey !== service.libraryKey || info.libraryKey !== libraryKey || info.instanceId !== service.instanceId) {
        throw new Error('Preview service changed or stopped. Open Obsidian with EagleBridge enabled, then retry.');
    }
    const text = formatLink(item, service.port, format, width);
    await clipboard.writeText(text);
    return text;
}

module.exports = { getItemContext, formatLink, copyItemLink };
