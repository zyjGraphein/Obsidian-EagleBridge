const { discoverServers } = require('./previewBridge');
const { getItemContext, copyItemLink } = require('./copyLinks');

module.exports = function mountCopyPanel(document, eagle, getItem, hideLinkForm) {
    const byId = id => document.getElementById(id);
    const trigger = byId('copyLinkBtn');
    const panel = byId('copyPanel');
    const status = byId('copyStatus');
    const select = byId('copyService');
    const width = byId('copyWidth');
    const retry = byId('copyRetry');
    const buttons = [...panel.querySelectorAll('[data-copy-format]')];
    let services = [], generation = 0, busy = false;
    try { width.value = document.defaultView.localStorage.getItem('eaglebridge.copyWidth') ?? '700'; } catch { /* Optional preference. */ }

    const selectedService = () => services.find(service => String(service.port) === select.value);
    function addAddress(label, value) {
        const option = document.createElement('option');
        option.textContent = label;
        option.value = value;
        select.add(option);
    }
    function updateButtons() {
        let hasItem = false;
        try { getItemContext(getItem()); hasItem = true; } catch { /* No selected item. */ }
        buttons.forEach(button => {
            button.disabled = busy || !hasItem || (button.dataset.copyFormat !== 'id' && !selectedService());
        });
        retry.disabled = busy;
        select.disabled = busy;
    }
    function close() {
        generation++;
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    }
    async function refresh() {
        const ticket = ++generation;
        busy = true;
        services = [];
        select.replaceChildren();
        select.hidden = true;
        status.textContent = 'Finding preview service…';
        status.title = '';
        updateButtons();
        try {
            const { libraryPath } = getItemContext(getItem());
            const found = await discoverServers(libraryPath);
            if (ticket !== generation) return;
            services = found;
            if (!found.length) {
                status.textContent = 'No preview service found. Update and reload EagleBridge in all open Obsidian vaults, check this library’s port, then retry.';
            } else {
                if (found.length > 1) addAddress('Choose a preview address', '');
                for (const service of found) {
                    addAddress(`${service.alias || 'Eagle'} · localhost:${service.port}`, String(service.port));
                }
                select.hidden = found.length === 1;
                status.textContent = found.length === 1
                    ? `localhost:${found[0].port}` : 'This library has more than one preview address.';
            }
        } catch (error) {
            if (ticket === generation) status.textContent = error.message || 'Cannot find the preview service. Retry.';
        } finally {
            if (ticket === generation) { busy = false; updateButtons(); }
        }
    }
    trigger.onclick = () => {
        if (!panel.hidden) { close(); return; }
        hideLinkForm();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        void refresh();
    };
    retry.onclick = refresh;
    select.onchange = updateButtons;
    panel.onkeydown = event => {
        if (event.key === 'Escape') { close(); trigger.focus(); }
    };
    width.onchange = () => {
        if (width.validity.valid) {
            try { document.defaultView.localStorage.setItem('eaglebridge.copyWidth', width.value); } catch { /* Optional preference. */ }
        }
    };
    for (const button of buttons) {
        button.onclick = async () => {
            const service = selectedService();
            if (busy || (button.dataset.copyFormat !== 'id' && !service)) return;
            if (button.dataset.copyFormat === 'embed' && (!width.validity.valid || (width.value !== '' && !/^[1-9]\d{0,4}$/.test(width.value)))) {
                status.textContent = 'Enter a width from 1 to 99999, or leave it blank.';
                width.focus();
                return;
            }
            const ticket = generation;
            const item = getItem();
            busy = true;
            updateButtons();
            try {
                const text = await copyItemLink(item, service, button.dataset.copyFormat, width.value, {
                    writeText: async text => {
                        if (ticket !== generation || getItem()?.id !== item.id || getItem()?.metadataFilePath !== item.metadataFilePath) {
                            throw new Error('Selection changed. Open the copy panel again.');
                        }
                        await eagle.clipboard.writeText(text);
                    },
                });
                if (ticket === generation) {
                    status.textContent = 'Copied';
                    status.title = text;
                }
            } catch (error) {
                if (ticket === generation) {
                    status.textContent = error.message || 'Could not copy. Retry.';
                    services = [];
                }
            } finally {
                if (ticket === generation) { busy = false; updateButtons(); }
            }
        };
    }
    return { close };
};
