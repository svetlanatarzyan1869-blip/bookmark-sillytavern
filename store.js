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

/* ============================================================================
 * Журнал для отчёта. Когда человек пишет «у меня не работает», по словам чинить
 * нельзя — нужен факт. Пишем ошибки, ненайденные цитаты и последние шаги;
 * храним в localStorage, чтобы отчёт пережил перезагрузку страницы.
 * ========================================================================== */
const LOG_KEY = 'bookmark_log';
const LOG_MAX = 24;
let LOG = { err: [], act: [], miss: [] };
try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) { const o = JSON.parse(raw); if (o) LOG = { err: o.err || [], act: o.act || [], miss: o.miss || [] }; }
} catch (e) { /* приватный режим или заблокированное хранилище — работаем в памяти */ }

const clip = (v, n = 240) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
function saveLog() { try { localStorage.setItem(LOG_KEY, JSON.stringify(LOG)); } catch (e) {} }

export function logErr(where, e) {
    const m = clip(e?.message || e?.reason || e || 'неизвестная ошибка', 300);
    if (LOG.err.some(x => x.m === m)) return;           // одно и то же не копим
    LOG.err.unshift({ t: Date.now(), w: where, m, s: clip(e?.stack, 500) });
    if (LOG.err.length > LOG_MAX) LOG.err.length = LOG_MAX;
    saveLog();
}
export function logAct(what) {
    LOG.act.unshift({ t: Date.now(), m: clip(what, 160) });
    if (LOG.act.length > LOG_MAX) LOG.act.length = LOG_MAX;
    saveLog();
}
export function logMiss(text) {
    const m = clip(text, 120);
    if (LOG.miss.includes(m)) return;
    LOG.miss.unshift(m);
    if (LOG.miss.length > 8) LOG.miss.length = 8;
    saveLog();
}
export function getLog() { return LOG; }
export function clearLog() { LOG = { err: [], act: [], miss: [] }; saveLog(); }
