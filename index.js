/* ============================================================================
 * bookmark⋆⭒˚.⋆ — расширение SillyTavern (порт плагина Tavo)
 * Панель-сборник + настройки + подключение движка выписки к событиям чата.
 * ========================================================================== */
import { settings, saveSettings, getQuotes, setQuotes, getFolders, setFolders,
         getColors, setColors, norm, toast } from './store.js';
import { decorate, ensureDecorated, paint, repaintAll, relayoutFlags, wire, jumpTo, unwrap } from './engine.js';

const ROOT_ID = 'cq-root';
const PACKS = [
    { k: 'main', name: 'Основные', cols: ['rgba(244,120,120,.55)', 'rgba(255,214,102,.55)', 'rgba(150,215,150,.55)', 'rgba(140,200,255,.55)', 'rgba(200,160,255,.55)'] },
    { k: 'pastel', name: 'Пастель', cols: ['rgba(255,192,203,.6)', 'rgba(255,228,170,.6)', 'rgba(190,235,205,.6)', 'rgba(190,215,245,.6)', 'rgba(222,205,245,.6)'] },
    { k: 'dark', name: 'Тёмные', cols: ['rgba(170,70,80,.5)', 'rgba(140,120,60,.5)', 'rgba(70,115,85,.5)', 'rgba(60,95,140,.5)', 'rgba(115,85,140,.5)'] },
    { k: 'custom', name: 'Свои', cols: [] },
];
const PATS = ['none', 'check', 'stripes', 'waves', 'dots', 'argyle'];

let root, pop, out, curFolder = 'all', movingId = null, notingId = null;
let fsetOpen = false, pickerOpen = false, curPackKey = 'main';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const preview = (s, n = 220) => { s = norm(s); return s.length > n ? s.slice(0, n) + '…' : s; };
const packCols = p => p.k === 'custom' ? getColors().slice() : p.cols;
const curPack = () => PACKS.find(p => p.k === curPackKey) || PACKS[0];
const folderById = id => getFolders().find(f => f.id === id) || null;
const byId = id => getQuotes().find(q => String(q.id) === String(id)) || null;
const inFolder = (r, f) => f === 'all' ? true : f === 'none' ? (r.folderId == null) : (r.folderId === f);
const countIn = f => getQuotes().filter(q => inFolder(q, f)).length;
const colorOf = fid => folderById(fid)?.color || null;

/* ── разметка ── */
const MARKUP = `
<button class="cq-fab" type="button" title="bookmark">📖</button>
<div class="cq-pop">
  <div class="cq-pop-head"><span class="cq-hdr-label">bookmark⋆⭒˚.⋆</span>
    <span class="cq-tools">
      <button class="cq-theme" type="button" title="тема">◐</button>
      <button class="cq-bg" type="button" title="фон">▤</button>
      <button class="cq-dood" type="button" title="каракули">✎</button>
      <button class="cq-refresh" type="button" title="обновить">⟳</button>
      <button class="cq-close" type="button" title="закрыть">✕</button>
    </span></div>
  <div class="cq-out"></div>
</div>`;

/* ── вид ── */
function applyLook() {
    const s = settings();
    root.classList.remove('cq-light', 'cq-dark', 'cq-glass', 'cq-base-dark', 'cq-base-light');
    const dark = document.body.classList.contains('dark') ||
        (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255])
            .slice(0, 3).reduce((a, v, i) => a + v * [0.299, 0.587, 0.114][i], 0) < 128;
    if (s.theme === 'light') root.classList.add('cq-light');
    else if (s.theme === 'dark') root.classList.add('cq-dark');
    else if (s.theme === 'glass') root.classList.add('cq-glass', dark ? 'cq-base-dark' : 'cq-base-light');
    else root.classList.add(dark ? 'cq-dark' : 'cq-light');
    root.classList.toggle('cq-bg-plain', s.bg === 'plain');
    root.classList.toggle('cq-nodoodle', !s.doodle);
    const ic = { auto: '◐', light: '☀', dark: '☾', glass: '❖' };
    root.querySelector('.cq-theme').textContent = ic[s.theme] || '◐';
    root.querySelector('.cq-bg').textContent = s.bg === 'plain' ? '▦' : '▤';
    root.querySelector('.cq-dood').style.opacity = s.doodle ? '1' : '.42';
}

/* ── палитра своих цветов ── */
function hsl2rgba(h, sp, lp, a) {
    const s = sp / 100, l = lp / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g] = [c, x]; else if (h < 120) [r, g] = [x, c];
    else if (h < 180) [g, b] = [c, x]; else if (h < 240) [g, b] = [x, c];
    else if (h < 300) [r, b] = [x, c]; else [r, b] = [c, x];
    return `rgba(${Math.round((r + m) * 255)},${Math.round((g + m) * 255)},${Math.round((b + m) * 255)},${a})`;
}
function paletteGrid() {
    const hues = [0, 22, 42, 58, 88, 128, 168, 192, 214, 244, 276, 308, 334];
    const rows = [[62, 80], [58, 68], [42, 56]];
    let h = '<div class="cq-picker"><div class="cq-pickttl">выбери цвет</div><div class="cq-pkgrid">';
    for (const [sp, lp] of rows) for (const hue of hues) {
        const c = hsl2rgba(hue, sp, lp, '.55');
        h += `<button class="cq-pk" data-col="${c}" style="background:${c}"></button>`;
    }
    for (const g of ['rgba(150,150,150,.5)', 'rgba(110,110,110,.5)', 'rgba(70,70,70,.45)'])
        h += `<button class="cq-pk" data-col="${g}" style="background:${g}"></button>`;
    return h + '</div></div>';
}

/* ── отрисовка сборника ── */
function chipsBar() {
    let c = `<button class="cq-chip" data-f="all">Все ${getQuotes().length}</button>`;
    c += `<button class="cq-chip${curFolder === 'none' ? ' on' : ''}" data-f="none">Без папки ${countIn('none')}</button>`;
    for (const f of getFolders()) {
        const pa = f.pattern && f.pattern !== 'none' ? ` data-pat="${f.pattern}"` : '';
        const st = f.color ? ` style="--bm-fc:${f.color}"` : '';
        c += `<button class="cq-chip${curFolder === f.id ? ' on' : ''}" data-f="${f.id}"${pa}${st}>${esc(f.name)} ${countIn(f.id)}</button>`;
    }
    c += '<button class="cq-chip cq-chip-add" data-f="__add">＋ папка</button>';
    return `<div class="cq-chips">${c}</div>`;
}
function itemCard(e) {
    const col = colorOf(e.folderId);
    let card = `<div class="cq-item${col ? ' cq-col' : ''}" data-id="${e.id}"${col ? ` style="--bm-c:${col}"` : ''}>` +
        `<div class="cq-quote">«${esc(preview(e.text))}»</div>`;
    if (e.note) card += `<div class="cq-note">${esc(e.note)}</div>`;
    card += '<div class="cq-item-tools">' +
        `<button class="cq-src" data-id="${e.id}" title="перейти к цитате">🔎</button>` +
        `<button class="cq-note-btn" data-id="${e.id}" title="заметка">📝</button>` +
        `<button class="cq-move" data-id="${e.id}" title="в папку">📁</button>` +
        `<button class="cq-del" data-id="${e.id}" title="удалить">🗑</button></div>`;
    if (String(notingId) === String(e.id)) {
        card += `<div class="cq-notebox"><textarea class="cq-note-ta" placeholder="твоя заметка…">${esc(e.note || '')}</textarea>` +
            `<div class="cq-note-row"><button class="cq-note-save" data-id="${e.id}">сохранить</button><button class="cq-note-cancel">✕</button></div></div>`;
    }
    if (String(movingId) === String(e.id)) {
        let o = `<button class="cq-mv" data-id="${e.id}" data-t="none">Без папки</button>`;
        for (const f of getFolders()) o += `<button class="cq-mv${e.folderId === f.id ? ' cur' : ''}" data-id="${e.id}" data-t="${f.id}">📁 ${esc(f.name)}</button>`;
        o += `<button class="cq-mv cq-mv-x" data-t="__cancel">✕</button>`;
        card += `<div class="cq-movebar"><span class="cq-mv-l">переместить в:</span>${o}</div>`;
    }
    return card + '</div>';
}
function draw() {
    const visible = getQuotes().filter(r => inFolder(r, curFolder));
    let h = chipsBar();
    if (curFolder !== 'all' && curFolder !== 'none') {
        const f = folderById(curFolder);
        const fpa = f?.pattern && f.pattern !== 'none' ? ` data-pat="${f.pattern}"` : '';
        const fst = f?.color ? ` style="--bm-fc:${f.color};background-color:${f.color}"` : '';
        h += `<div class="cq-folderbar"${fpa}${fst}><span>${esc(f?.name || '')}</span>` +
            `<span class="cq-fbtools"><button class="cq-fset${fsetOpen ? ' on' : ''}">${fsetOpen ? '⌄' : '›'}</button></span></div>`;
        if (fsetOpen) {
            h += '<div class="cq-fbox"><div class="cq-fsrow"><button class="cq-frename">✏️ переименовать</button><button class="cq-fdelete">🗑 удалить папку</button></div>';
            h += '<div class="cq-fslbl">орнамент</div><div class="cq-pats">';
            for (const pn of PATS) h += `<button class="cq-pat${((f?.pattern) || 'none') === pn ? ' on' : ''}" data-p="${pn}"${f?.color ? ` style="background-color:${f.color}"` : ''}></button>`;
            h += '</div><div class="cq-fslbl">цвет</div><div class="cq-packtabs">';
            for (const p of PACKS) h += `<button class="cq-packtab${p.k === curPackKey ? ' on' : ''}" data-pk="${p.k}">${p.name}</button>`;
            h += '</div><div class="cq-swatches">';
            const cols = packCols(curPack());
            for (const c of cols) h += `<span class="cq-swwrap"><button class="cq-sw${f?.color === c ? ' on' : ''}" data-col="${c}" style="background:${c}"></button>` +
                (curPackKey === 'custom' ? `<button class="cq-swdel" data-del="${c}">×</button>` : '') + '</span>';
            if (curPackKey === 'custom') {
                if (!cols.length && !pickerOpen) h += '<span class="cq-swhint">своих цветов пока нет</span>';
                h += `<button class="cq-swadd${pickerOpen ? ' on' : ''}">${pickerOpen ? '×' : '＋'}</button>`;
            }
            h += '</div>';
            if (curPackKey === 'custom' && pickerOpen) h += paletteGrid();
            h += '</div>';
        }
    }
    h += visible.length ? visible.map(itemCard).join('')
        : `<div class="cq-empty">${getQuotes().length ? 'В этой папке пусто.' : 'Пока пусто.<br>Двойной тап по фразе в сообщении — и она здесь.'}</div>`;
    out.innerHTML = h;
    wireList();
}

/* ── обработчики списка ── */
function wireList() {
    const q = s => out.querySelectorAll(s);
    q('.cq-chip').forEach(b => b.addEventListener('click', async ev => {
        ev.stopPropagation();
        const f = b.dataset.f;
        if (f === '__add') {
            const nn = prompt('Название новой папки:');
            if (!nn) return;
            const list = getFolders().slice();
            list.push({ id: 'f' + Date.now(), name: nn, color: PACKS[0].cols[list.length % 5], pattern: 'none' });
            await setFolders(list); curFolder = list.at(-1).id; fsetOpen = true;
        } else { curFolder = f; fsetOpen = false; }
        draw();
    }));
    out.querySelector('.cq-fset')?.addEventListener('click', ev => { ev.stopPropagation(); fsetOpen = !fsetOpen; draw(); });
    out.querySelector('.cq-frename')?.addEventListener('click', async ev => {
        ev.stopPropagation(); const f = folderById(curFolder); if (!f) return;
        const nn = prompt('Новое название:', f.name); if (!nn) return;
        f.name = nn; await setFolders(getFolders()); draw();
    });
    out.querySelector('.cq-fdelete')?.addEventListener('click', async ev => {
        ev.stopPropagation();
        if (!confirm('Удалить папку? Цитаты останутся, но станут «без папки».')) return;
        const qs = getQuotes().map(x => x.folderId === curFolder ? { ...x, folderId: null } : x);
        await setFolders(getFolders().filter(x => x.id !== curFolder));
        await setQuotes(qs);
        curFolder = 'all'; fsetOpen = false; draw(); repaintAll();
    });
    q('.cq-pat').forEach(b => b.addEventListener('click', async ev => {
        ev.stopPropagation(); const f = folderById(curFolder); if (!f) return;
        f.pattern = b.dataset.p; await setFolders(getFolders()); draw();
    }));
    q('.cq-packtab').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); curPackKey = b.dataset.pk; draw(); }));
    q('.cq-sw').forEach(b => b.addEventListener('click', async ev => {
        ev.stopPropagation(); const f = folderById(curFolder); if (!f) return;
        f.color = b.dataset.col; await setFolders(getFolders()); draw(); repaintAll();
    }));
    out.querySelector('.cq-swadd')?.addEventListener('click', ev => { ev.stopPropagation(); pickerOpen = !pickerOpen; draw(); });
    q('.cq-pk').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation();
        const c = b.dataset.col, list = getColors().slice();
        if (!list.includes(c)) list.push(c);
        setColors(list); pickerOpen = false; draw(); toast('🎨 Цвет добавлен');
    }));
    q('.cq-swdel').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation(); setColors(getColors().filter(c => c !== b.dataset.del)); draw();
    }));
    q('.cq-src').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation(); const e = byId(b.dataset.id); if (!e) return;
        if (jumpTo(e)) root.classList.remove('open');
    }));
    q('.cq-note-btn').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation(); notingId = String(notingId) === b.dataset.id ? null : b.dataset.id; draw();
    }));
    out.querySelector('.cq-note-save')?.addEventListener('click', async ev => {
        ev.stopPropagation();
        const e = byId(out.querySelector('.cq-note-save').dataset.id); if (!e) return;
        e.note = out.querySelector('.cq-note-ta').value;
        await setQuotes(getQuotes()); notingId = null; draw();
    });
    out.querySelector('.cq-note-cancel')?.addEventListener('click', ev => { ev.stopPropagation(); notingId = null; draw(); });
    q('.cq-move').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation(); movingId = String(movingId) === b.dataset.id ? null : b.dataset.id; draw();
    }));
    q('.cq-mv').forEach(b => b.addEventListener('click', async ev => {
        ev.stopPropagation();
        const t = b.dataset.t;
        if (t !== '__cancel') {
            const e = byId(b.dataset.id);
            if (e) { e.folderId = t === 'none' ? null : t; await setQuotes(getQuotes()); }
        }
        movingId = null; draw(); repaintAll();
    }));
    q('.cq-del').forEach(b => b.addEventListener('click', async ev => {
        ev.stopPropagation();
        if (!confirm('Удалить цитату?')) return;
        await setQuotes(getQuotes().filter(x => String(x.id) !== b.dataset.id));
        draw(); repaintAll();
    }));
}

/* ── перерисовка чата ── */
let io = null;
function observer() {
    if (io) return io;
    io = new IntersectionObserver(entries => {
        for (const en of entries) {
            if (!en.isIntersecting) continue;
            const st = ensureDecorated(en.target);
            if (st) paint(st);
        }
    }, { root: null, rootMargin: '400px 0px' });   // готовим чуть заранее
    return io;
}
function decorateAll() {
    const ob = observer();
    const vh = window.innerHeight || 800;
    document.querySelectorAll('#chat .mes_text').forEach(el => {
        ob.observe(el);
        // подстраховка: то, что уже на экране, разбираем сразу и не ждём наблюдателя
        const r = el.getBoundingClientRect();
        if (r.bottom > -400 && r.top < vh + 400) { const st = ensureDecorated(el); if (st) paint(st); }
    });
}
function decorateOne(mesEl) {
    const t = mesEl?.querySelector?.('.mes_text');
    if (!t) return;
    observer().observe(t);
    if (t.getBoundingClientRect().top < innerHeight + 400) paint(ensureDecorated(t));
}

/* ── страница настроек ── */
function addSettingsPanel() {
    const s = settings();
    const html = `
    <div class="bookmark-settings">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>bookmark⋆⭒˚.⋆</b> <small style="opacity:.6">v2.0.7</small><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <label class="checkbox_label"><input id="bm_doodle" type="checkbox" ${s.doodle ? 'checked' : ''}><span>Каракули на плашке</span></label>
          <label for="bm_theme">Тема</label>
          <select id="bm_theme" class="text_pole">
            <option value="auto">авто</option><option value="light">светлая</option>
            <option value="dark">тёмная</option><option value="glass">стекло</option>
          </select>
          <label for="bm_bg">Фон плашки</label>
          <select id="bm_bg" class="text_pole"><option value="paper">бумага</option><option value="plain">однотонный</option></select>
          <div class="flex-container" style="margin-top:6px">
            <input id="bm_reset_pos" class="menu_button" type="button" value="Вернуть плашку на место">
          </div>
          <small>Двойной тап по фразе в сообщении — выписать. Метки по краям тянут границы.</small>
        </div>
      </div>
    </div>`;
    $('#extensions_settings2').append(html);
    $('#bm_theme').val(s.theme); $('#bm_bg').val(s.bg);
    $('#bm_theme').on('change', function () { settings().theme = this.value; saveSettings(); applyLook(); });
    $('#bm_bg').on('change', function () { settings().bg = this.value; saveSettings(); applyLook(); });
    $('#bm_doodle').on('change', function () { settings().doodle = this.checked; saveSettings(); applyLook(); });
    $('#bm_reset_pos').on('click', function () {
        const st = settings(); delete st.fabPos; delete st.popPos; saveSettings();
        for (const el of [root.querySelector('.cq-fab'), pop]) {
            el.style.left = ''; el.style.top = ''; el.style.right = ''; el.style.bottom = '';
        }
        toast('Плашка возвращена на место', 'success');
    });
}

/* ── запуск ── */
function mount() {
    if (document.getElementById(ROOT_ID)) return;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = MARKUP;
    document.body.appendChild(root);
    pop = root.querySelector('.cq-pop');
    out = root.querySelector('.cq-out');

    const fabEl = root.querySelector('.cq-fab');
    const toggle = () => {
        if (Date.now() - (fabEl.__cqMoved || 0) < 250) return;   // это было перетаскивание
        if (Date.now() - (fabEl.__cqTapped || 0) < 400) return;  // тап уже обработан
        fabEl.__cqTapped = Date.now();
        root.classList.toggle('open');
        if (root.classList.contains('open')) {
            draw();
            // размеры известны только у видимого элемента — правим положение уже после показа
            requestAnimationFrame(() => { clampIntoView(pop); setTimeout(() => clampIntoView(pop), 60); });
        }
        clampIntoView(root.querySelector('.cq-fab'));
    };
    fabEl.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    fabEl.addEventListener('touchend', e => { e.stopPropagation(); toggle(); }, { passive: true });
    root.querySelector('.cq-close').addEventListener('click', e => { e.stopPropagation(); root.classList.remove('open'); });
    root.querySelector('.cq-refresh').addEventListener('click', e => { e.stopPropagation(); decorateAll(); draw(); });
    root.querySelector('.cq-theme').addEventListener('click', e => {
        e.stopPropagation();
        const order = ['auto', 'light', 'dark', 'glass'], s = settings();
        s.theme = order[(order.indexOf(s.theme) + 1) % order.length]; saveSettings(); applyLook();
    });
    root.querySelector('.cq-bg').addEventListener('click', e => {
        e.stopPropagation(); const s = settings(); s.bg = s.bg === 'paper' ? 'plain' : 'paper'; saveSettings(); applyLook();
    });
    root.querySelector('.cq-dood').addEventListener('click', e => {
        e.stopPropagation(); const s = settings(); s.doodle = !s.doodle; saveSettings(); applyLook();
    });
    dragify(root.querySelector('.cq-fab'), 'fabPos', root.querySelector('.cq-fab'));
    dragify(pop, 'popPos', pop.querySelector('.cq-pop-head'));
    restorePos(root.querySelector('.cq-fab'), 'fabPos');
    restorePos(pop, 'popPos');
    applyLook();
}

/* ── перетаскивание: элемент двигается за пальцем/мышью, позиция запоминается ── */
function restorePos(el, key) {
    const p = settings()[key];
    if (!p || typeof p.left !== 'number') return;
    // позиция общая для всех устройств: если экран сильно другой (компьютер ↔ телефон),
    // сохранённые координаты бессмысленны — оставляем положение из CSS
    if (typeof p.vw === 'number' && Math.abs(p.vw - innerWidth) > 200) return;
    el.style.left = p.left + 'px'; el.style.top = p.top + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
    clampIntoView(el);
}
/* позиция общая для всех устройств: то, что удобно на компьютере,
   на телефоне запросто оказывается за краем — поэтому всегда подтягиваем внутрь */
function clampIntoView(el) {
    if (!el || el.style.left === '') return;
    // у скрытого элемента размеры нулевые — мерить бесполезно, вернёмся когда покажется
    if (!el.offsetWidth || !el.offsetHeight) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const maxL = Math.max(2, innerWidth - w - 2), maxT = Math.max(2, innerHeight - h - 2);
    const l = Math.min(Math.max(2, parseFloat(el.style.left) || 0), maxL);
    const t = Math.min(Math.max(2, parseFloat(el.style.top) || 0), maxT);
    el.style.left = l + 'px'; el.style.top = t + 'px';
}
function clampAll() {
    clampIntoView(root.querySelector('.cq-fab'));
    clampIntoView(pop);
}
function dragify(el, key, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, active = false, raf = 0, nx = 0, ny = 0;
    const point = e => e.touches ? e.touches[0] : e;
    const apply = () => {
        raf = 0;
        el.style.left = nx + 'px'; el.style.top = ny + 'px';
        el.style.right = 'auto'; el.style.bottom = 'auto';
    };
    const down = e => {
        const t = point(e); if (!t) return;
        const r = el.getBoundingClientRect();
        sx = t.clientX; sy = t.clientY; ox = r.left; oy = r.top;
        moved = false; active = true;
        // на touchstart НЕ гасим событие — иначе браузер не пришлёт click и по тапу ничего не откроется
        if (!e.touches && e.cancelable) e.preventDefault();
    };
    const move = e => {
        if (!active) return;
        const t = point(e); if (!t) return;
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        moved = true;
        const w = el.offsetWidth, h = el.offsetHeight;
        nx = Math.max(2, Math.min(innerWidth - w - 2, ox + dx));
        ny = Math.max(2, Math.min(innerHeight - h - 2, oy + dy));
        if (!raf) raf = requestAnimationFrame(apply);
        if (e.cancelable) e.preventDefault();
    };
    const up = () => {
        if (!active) return;
        active = false;
        if (moved) {
            const r = el.getBoundingClientRect();
            settings()[key] = { left: Math.round(r.left), top: Math.round(r.top), vw: innerWidth };
            saveSettings();
            el.__cqMoved = Date.now();     // чтобы клик после перетаскивания не сработал
        }
    };
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: false });
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('mouseup', up);
    document.addEventListener('touchend', up);
}

jQuery(async () => {
    const { eventSource, event_types } = SillyTavern.getContext();
    mount();
    addSettingsPanel();
    wire(() => { if (root.classList.contains('open')) draw(); });

    const redo = () => setTimeout(decorateAll, 60);
    eventSource.on(event_types.APP_READY, redo);
    eventSource.on(event_types.CHAT_CHANGED, () => { curFolder = 'all'; fsetOpen = false; redo(); });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, id => decorateOne(document.querySelector(`#chat .mes[mesid="${id}"]`)));
    eventSource.on(event_types.USER_MESSAGE_RENDERED, id => decorateOne(document.querySelector(`#chat .mes[mesid="${id}"]`)));
    eventSource.on(event_types.MESSAGE_UPDATED, id => decorateOne(document.querySelector(`#chat .mes[mesid="${id}"]`)));
    eventSource.on(event_types.MESSAGE_SWIPED, redo);
    let rz = 0;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { clampAll(); relayoutFlags(); }, 200); });
    window.addEventListener('orientationchange', () => setTimeout(clampAll, 300));
    redo();
    console.log('[bookmark] готово, v2.0.7');
    // самодиагностика: что реально применилось к тексту
    setTimeout(() => {
        const q = document.querySelector('#cq-root .cq-hdr-label');
        if (q) console.log('[bookmark] цвет заголовка:', getComputedStyle(q).color,
                           '| фон плашки:', getComputedStyle(document.querySelector('#cq-root .cq-pop')).backgroundColor,
                           '| классы:', document.getElementById('cq-root').className);
    }, 800);
});
