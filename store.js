/* ============================================================================
 * bookmark⋆⭒˚.⋆ — хранилище (порт из Tavo)
 *
 * В Tavo всё лежало в tavo.get/set со скоупом 'chat'. В SillyTavern:
 *   • цитаты и папки  → chatMetadata (своё на каждый чат) + saveMetadata()
 *   • свои цвета и настройки вида → extensionSettings (общее) + saveSettingsDebounced()
 * ========================================================================== */
export const MODULE = 'bookmark_quotes';

const DEFAULTS = Object.freeze({
    colors: [],          // свои цвета (общие для всех чатов)
    theme: 'auto',       // auto | light | dark | glass
    bg: 'paper',         // paper | plain
    doodle: true,        // каракули вкл/выкл
});

function ctx() { return SillyTavern.getContext(); }

/* ── общие настройки ── */
export function settings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = structuredClone(DEFAULTS);
    for (const k of Object.keys(DEFAULTS)) {
        if (!Object.hasOwn(extensionSettings[MODULE], k)) extensionSettings[MODULE][k] = DEFAULTS[k];
    }
    return extensionSettings[MODULE];
}
export function saveSettings() { ctx().saveSettingsDebounced(); }

/* ── данные текущего чата ── */
function meta() {
    const { chatMetadata } = ctx();
    if (!chatMetadata[MODULE]) chatMetadata[MODULE] = { quotes: [], folders: [] };
    const m = chatMetadata[MODULE];
    if (!Array.isArray(m.quotes)) m.quotes = [];
    if (!Array.isArray(m.folders)) m.folders = [];
    return m;
}
export function getQuotes() { return meta().quotes; }
export function getFolders() { return meta().folders; }
export async function saveChat() { try { await ctx().saveMetadata(); } catch (e) { console.error('[bookmark] saveMetadata', e); } }

export async function setQuotes(list) {
    const m = meta();
    m.quotes = Array.isArray(list) ? list.slice(0, 300) : [];
    await saveChat();
}
export async function setFolders(list) {
    meta().folders = Array.isArray(list) ? list : [];
    await saveChat();
}

/* ── свои цвета ── */
export function getColors() { return settings().colors; }
export function setColors(list) { settings().colors = Array.isArray(list) ? list : []; saveSettings(); }

/* ── утилиты ── */
export function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
export function toast(msg, type = 'info') {
    try { window.toastr?.[type]?.(msg, '', { timeOut: 1800 }); }
    catch (e) { console.log('[bookmark]', msg); }
}
