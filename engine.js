/* ============================================================================
 * bookmark⋆⭒˚.⋆ — движок в чате (порт inchat.js из Tavo)
 *
 * Отличия от Tavo-версии (там всё это было костылями вокруг изоляции):
 *   • нет регекса, нет версионного захвата, нет сторожа за подменой узла —
 *     работаем прямо с .mes_text по событиям рендера;
 *   • источник цитаты — mesId, а не копия текста: переход точный;
 *   • слушатели вешаются на document ОДИН раз.
 * ========================================================================== */
import { getQuotes, setQuotes, getFolders, norm, toast } from './store.js';

const DEF = 'rgba(255,214,102,.55)';
const SKIP = { SCRIPT: 1, STYLE: 1, BUTTON: 1, SVG: 1, PATH: 1, DETAILS: 1, SUMMARY: 1, INPUT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, A: 1, IMG: 1, MARK: 1 };

let draft = null;          // { st, s, e } — st это состояние конкретного сообщения
let bar = null, h1 = null, h2 = null, drag = 0;
let onPick = null;         // колбэк «сборник обновился»

/* ── разбор одного сообщения ── */
function sentRanges(t) {
    const out = []; let i = 0; const N = t.length, SEP = '.!?…';
    while (i < N) {
        let s = i, e = i;
        while (e < N && SEP.indexOf(t.charAt(e)) < 0) e++;
        while (e < N && SEP.indexOf(t.charAt(e)) >= 0) e++;
        if (e <= s) e = s + 1;
        if (norm(t.slice(s, e)).length >= 2) out.push([s, e]);
        i = e;
    }
    return out;
}
function bad(el, root) {
    while (el && el !== root) {
        if (SKIP[el.tagName]) return true;
        if (el.tagName === 'DIV' && el.getAttribute?.('style')) return true;
        if (String(el.className || '').includes('cq-')) return true;
        el = el.parentElement;
    }
    return false;
}
function blockOf(n, root) {
    let el = n.parentElement;
    while (el && el !== root) {
        const t = el.tagName;
        if (t === 'P' || t === 'LI' || t === 'BLOCKQUOTE' || t === 'DIV') return el;
        el = el.parentElement;
    }
    return root;
}

export function unwrap(root) {
    root.querySelectorAll('.cq-w,.cq-g').forEach(e => {
        if (e.parentNode) e.parentNode.replaceChild(document.createTextNode(e.textContent), e);
    });
    root.querySelectorAll('.cq-bar,.cq-h,.cq-flag').forEach(e => e.remove());
    try { root.normalize(); } catch (e) {}
}

/* оборачиваем слова и пробелы; пробелы нужны, чтобы подсветка шла сплошной линией */
export function ensureDecorated(root) {
    if (!root) return null;
    const sig = root.textContent.length + '|' + root.childNodes.length;
    if (root.__cq && root.__cqSig === sig) return root.__cq;   // ничего не изменилось — не трогаем
    const st = decorate(root);
    root.__cqSig = root.textContent.length + '|' + root.childNodes.length;
    return st;
}
export function decorate(root) {
    if (!root) return null;
    unwrap(root);
    const st = { root, WSEG: [], GSEG: [], WTEXT: [], WSENT: [], SENTR: {}, SID: 0, RUNS: [] };

    const nodes = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (n.nodeValue?.trim() && !bad(n.parentElement, root)) nodes.push(n);

    const blocks = [], lists = [];
    for (const nd of nodes) {
        const b = blockOf(nd, root), k = blocks.indexOf(b);
        if (k < 0) { blocks.push(b); lists.push([nd]); } else lists[k].push(nd);
    }
    for (const group of lists) wrapGroup(st, group);
    root.__cq = st;
    return st;
}

function wrapGroup(st, ns) {
    let concat = ''; const starts = [];
    for (const nd of ns) { starts.push(concat.length); concat += nd.nodeValue; }
    const sr = sentRanges(concat);
    if (!sr.length) return;

    const words = []; let i = 0; const N = concat.length;
    while (i < N) {
        while (i < N && /\s/.test(concat.charAt(i))) i++;
        if (i >= N) break;
        const s = i;
        while (i < N && !/\s/.test(concat.charAt(i))) i++;
        let sid = -1;
        for (let r = 0; r < sr.length; r++) if (s >= sr[r][0] && s < sr[r][1]) { sid = r; break; }
        words.push([s, i, sid]);
    }
    if (!words.length) return;

    const base = st.WTEXT.length, sidBase = st.SID; st.SID += sr.length;
    words.forEach((wd, k) => {
        const gi = base + k;
        st.WTEXT[gi] = norm(concat.slice(wd[0], wd[1]));
        st.WSEG[gi] = [];
        const gs = wd[2] < 0 ? -1 : sidBase + wd[2];
        st.WSENT[gi] = gs;
        if (gs >= 0) { if (!st.SENTR[gs]) st.SENTR[gs] = [gi, gi]; else st.SENTR[gs][1] = gi; }
    });

    let prevW = -1;
    ns.forEach((nd, idx) => {
        const v = nd.nodeValue, s0 = starts[idx], e0 = s0 + v.length, pieces = [];
        words.forEach((wd, k) => {
            const a = Math.max(wd[0], s0), b = Math.min(wd[1], e0);
            if (b > a) pieces.push([a - s0, b - s0, base + k]);
        });
        if (!pieces.length) return;
        const frag = document.createDocumentFragment();
        let pos = 0, any = false;
        const gapNode = (txt) => {
            if (prevW >= 0 && !/\S/.test(txt)) {
                const g = document.createElement('span');
                g.className = 'cq-g'; g.dataset.g = String(prevW); g.textContent = txt;
                (st.GSEG[prevW] ||= []).push(g);
                return g;
            }
            return document.createTextNode(txt);
        };
        for (const [ps, pe, gi] of pieces) {
            if (ps > pos) frag.appendChild(gapNode(v.slice(pos, ps)));
            const sp = document.createElement('span');
            sp.className = 'cq-w'; sp.dataset.w = String(gi); sp.textContent = v.slice(ps, pe);
            frag.appendChild(sp); st.WSEG[gi].push(sp); any = true; prevW = gi; pos = pe;
        }
        if (pos < v.length) frag.appendChild(gapNode(v.slice(pos)));
        if (any && nd.parentNode) nd.parentNode.replaceChild(frag, nd);
    });
}

/* ── подсветка сохранённых цитат ── */
function runOn(st, s, e, cls, color) {
    for (let i = s; i <= e; i++) {
        (st.WSEG[i] || []).forEach(el => { el.classList.add(cls); if (color) el.style.background = color; });
        if (i < e) (st.GSEG[i] || []).forEach(el => { el.classList.add(cls); if (color) el.style.background = color; });
    }
    const a = st.WSEG[s]?.[0], b = st.WSEG[e]?.at(-1);
    if (a) { a.style.borderTopLeftRadius = '4px'; a.style.borderBottomLeftRadius = '4px'; }
    if (b) { b.style.borderTopRightRadius = '4px'; b.style.borderBottomRightRadius = '4px'; }
}
function runClear(st, cls) {
    const c = el => { el.classList.remove(cls); el.style.background = ''; el.style.borderRadius = ''; };
    for (let i = 0; i < st.WSEG.length; i++) { (st.WSEG[i] || []).forEach(c); (st.GSEG[i] || []).forEach(c); }
}
function findRun(st, text) {
    const qw = norm(text).split(' '), L = qw.length;
    if (!L || !qw[0]) return -1;
    outer: for (let i = 0; i + L <= st.WTEXT.length; i++) {
        for (let j = 0; j < L; j++) if (st.WTEXT[i + j] !== qw[j]) continue outer;
        return i;
    }
    return -1;
}
export function paint(st) {
    if (!st) return;
    const col = {}; getFolders().forEach(f => { if (f?.id) col[f.id] = f.color || DEF; });
    runClear(st, 'cq-on'); st.RUNS = [];
    st.WSEG.forEach(sg => sg?.forEach(el => el.removeAttribute('data-q')));
    st.root.querySelectorAll('.cq-flag').forEach(e => e.remove());

    for (const q of getQuotes()) {
        if (!q?.text) continue;
        const t = norm(q.text), at = findRun(st, t);
        if (at < 0) continue;
        const L = t.split(' ').length;
        const c = (q.folderId && col[q.folderId]) || DEF;
        runOn(st, at, at + L - 1, 'cq-on', c);
        for (let j = 0; j < L; j++) (st.WSEG[at + j] || []).forEach(el => el.dataset.q = t);
        st.RUNS.push([at, at + L - 1, c]);
    }
    flags(st);
}
function flags(st) {
    const rr = st.root.getBoundingClientRect();
    if (getComputedStyle(st.root).position === 'static') st.root.style.position = 'relative';
    for (const [s, , c] of st.RUNS) {
        const a = st.WSEG[s]?.[0]; if (!a) continue;
        const ra = a.getBoundingClientRect();
        if (!ra.width && !ra.height) continue;
        const f = document.createElement('div');
        f.className = 'cq-flag';
        f.style.top = (ra.top - rr.top + Math.max(0, (ra.height - 16) / 2)) + 'px';
        f.style.borderColor = 'transparent ' + c + ' transparent transparent';
        st.root.appendChild(f);
    }
}
export function repaintAll() {
    document.querySelectorAll('#chat .mes_text').forEach(el => { if (el.__cq) paint(el.__cq); });
}
/* флажки требуют чтения геометрии — собираем все замеры разом, потом пишем */
export function relayoutFlags() { document.querySelectorAll('#chat .mes_text').forEach(el => el.__cq && flags(el.__cq)); }

/* ── черновик, метки, панель ── */
function firstSeg(st, i) { return st.WSEG[i]?.[0] || null; }
function lastSeg(st, i) { return st.WSEG[i]?.at(-1) || null; }
function draftText() { return draft ? norm(draft.st.WTEXT.slice(draft.s, draft.e + 1).join(' ')) : ''; }

function clearDraft() {
    if (draft) runClear(draft.st, 'cq-draft');
    draft = null;
    bar?.remove(); bar = null;
    h1?.remove(); h2?.remove(); h1 = h2 = null;
}
function mkH(which) {
    const h = document.createElement('div');
    h.className = 'cq-h';
    const k = document.createElement('i'); k.className = 'cq-knob';
    const s = document.createElement('i'); s.className = 'cq-stem';
    h.append(k, s);
    h.addEventListener('mousedown', e => { drag = which; buildRectCache(draft.st); e.preventDefault(); });
    h.addEventListener('touchstart', e => { drag = which; buildRectCache(draft.st); e.preventDefault(); }, { passive: false });
    return h;
}
function renderDraft() {
    if (!draft) return;
    const st = draft.st;
    runClear(st, 'cq-draft');
    runOn(st, draft.s, draft.e, 'cq-draft', null);
    if (getComputedStyle(st.root).position === 'static') st.root.style.position = 'relative';
    if (!h1) { h1 = mkH(1); h2 = mkH(2); st.root.append(h1, h2); }
    if (!bar) { bar = buildBar(); st.root.appendChild(bar); }
    place();
}
function place() {
    if (!draft || !h1) return;
    const st = draft.st;
    const a = firstSeg(st, draft.s), b = lastSeg(st, draft.e);
    if (!a || !b) return;
    const rr = st.root.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    h1.style.left = (ra.left - rr.left) + 'px'; h1.style.top = (ra.top - rr.top - 4) + 'px'; h1.style.height = (ra.height + 8) + 'px';
    h2.style.left = (rb.right - rr.left) + 'px'; h2.style.top = (rb.top - rr.top - 4) + 'px'; h2.style.height = (rb.height + 8) + 'px';
    h1.classList.add('on'); h2.classList.add('on');
    if (bar) {
        const bh = bar.offsetHeight || 34, bw = bar.offsetWidth || 160;
        let top = ra.top - rr.top - bh - 10;
        if (top < 2) top = rb.bottom - rr.top + 10;
        let left = ra.left - rr.left - 10;
        const mx = rr.width - bw;
        if (left > mx) left = mx; if (left < 0) left = 0;
        bar.style.left = left + 'px'; bar.style.top = top + 'px';
    }
}
function press(el, fn) {
    let done = 0;
    const go = e => {
        if (Date.now() - done < 600) return;
        done = Date.now(); e.preventDefault(); e.stopPropagation(); fn();
    };
    el.addEventListener('touchstart', go, { passive: false });
    el.addEventListener('click', go);
}
function buildBar() {
    const b = document.createElement('div');
    b.className = 'cq-bar';
    const ok = document.createElement('button'); ok.className = 'cq-ok'; ok.textContent = '✓ выписать';
    press(ok, () => save(null));
    b.appendChild(ok);
    getFolders().slice(0, 8).forEach(f => {
        if (!f?.id) return;
        const c = document.createElement('button'); c.className = 'cq-chip2';
        const d = document.createElement('i'); d.className = 'cq-dot2'; d.style.background = f.color || DEF;
        c.appendChild(d);
        const nm = String(f.name || 'папка');
        c.appendChild(document.createTextNode(nm.length > 10 ? nm.slice(0, 10) + '…' : nm));
        press(c, () => save(f.id));
        b.appendChild(c);
    });
    const no = document.createElement('button'); no.className = 'cq-no'; no.textContent = '✕';
    press(no, () => clearDraft());
    b.appendChild(no);
    return b;
}

/* ── сохранение / удаление ── */
function mesIdOf(st) {
    const mes = st.root.closest('.mes');
    const id = mes?.getAttribute('mesid');
    return id == null ? null : Number(id);
}
async function save(folderId) {
    const t = draftText();
    if (t.length < 2) { toast('Пустое выделение', 'warning'); clearDraft(); return; }
    const list = getQuotes().slice();
    if (!list.some(q => norm(q.text) === t)) {
        list.unshift({ id: Date.now(), text: t, note: '', folderId: folderId ?? null, ts: Date.now(), mesId: mesIdOf(draft.st) });
    }
    const st = draft.st;
    clearDraft();
    await setQuotes(list);
    toast('📖 выписано', 'success');
    paint(st); onPick?.();
}
async function removeQ(t) {
    const st = draft?.st;
    await setQuotes(getQuotes().filter(q => norm(q.text) !== t));
    toast('🗑 убрала');
    repaintAll(); onPick?.();
}

/* ── тапы и перетаскивание ── */
function stOf(el) {
    const holder = el?.closest?.('.mes_text');
    return holder?.__cq || null;
}
function wOf(el) {
    while (el && !el.classList?.contains('mes_text')) {
        if (el.classList?.contains('cq-w') && el.dataset.w != null) return Number(el.dataset.w);
        el = el.parentElement;
    }
    return -1;
}
let rectCache = null;
function buildRectCache(st) {
    rectCache = [];
    for (let i = 0; i < st.WSEG.length; i++)
        for (const sg of st.WSEG[i] || []) {
            const r = sg.getBoundingClientRect();
            if (r.width || r.height) rectCache.push([i, r.left, r.top, r.right, r.bottom]);
        }
}
function wordAtCached(x, y) {
    let best = -1, bd = Infinity;
    for (const [i, l, t, rr, bb] of rectCache || []) {
        const dx = x < l ? l - x : (x > rr ? x - rr : 0);
        const dy = y < t ? t - y : (y > bb ? y - bb : 0);
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}
function wordAt(st, x, y) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < st.WSEG.length; i++) {
        for (const sg of st.WSEG[i] || []) {
            const r = sg.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            const dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
            const dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
            const d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; }
        }
    }
    return best;
}
let tapT = 0, tapW = -1;
function onTap(st, w, e) {
    if (w < 0 || !st) return;
    if (draft && draft.st === st) {
        e.preventDefault(); e.stopPropagation();
        if (w < draft.s) draft.s = w;
        else if (w > draft.e) draft.e = w;
        else if (w - draft.s <= draft.e - w) draft.s = w; else draft.e = w;
        renderDraft(); return;
    }
    const now = Date.now();
    if (tapW >= 0 && now - tapT < 1200) {
        e.preventDefault(); e.stopPropagation();
        tapT = 0; tapW = -1;
        const q = st.WSEG[w]?.[0]?.dataset.q;
        if (q) { removeQ(q); return; }
        clearDraft();
        const sid = st.WSENT[w], r = (sid >= 0 && st.SENTR[sid]) ? st.SENTR[sid] : [w, w];
        draft = { st, s: r[0], e: r[1] };
        renderDraft(); return;
    }
    tapT = now; tapW = w;
}

let wired = false;
export function wire(onChange) {
    onPick = onChange;
    if (wired) return; wired = true;

    document.addEventListener('click', e => {
        if (drag) return;
        const st = stOf(e.target); if (!st) return;
        onTap(st, wOf(e.target), e);
    }, true);

    let pending = null, lastDrag = 0;
    const applyDrag = () => {
        if (!pending || !drag || !draft) return;
        const w = wordAtCached(pending.x, pending.y);
        pending = null;
        if (w < 0) return;
        if (drag === 1) { if (w <= draft.e && w !== draft.s) { draft.s = w; renderDraft(); } }
        else if (w >= draft.s && w !== draft.e) { draft.e = w; renderDraft(); }
    };
    const queue = (x, y, e) => {
        if (!drag || !draft) return;
        pending = { x, y };
        // придержка по времени, а не по кадру: кадры на телефоне браузер экономит,
        // и метка переставала ехать за пальцем
        const now = Date.now();
        if (now - lastDrag >= 16) { lastDrag = now; applyDrag(); }
        e.preventDefault();
    };
    document.addEventListener('mousemove', e => queue(e.clientX, e.clientY, e));
    document.addEventListener('touchmove', e => {
        const t = e.touches[0]; if (t) queue(t.clientX, t.clientY, e);
    }, { passive: false });
    document.addEventListener('mouseup', () => { drag = 0; rectCache = null; });
    document.addEventListener('touchend', () => { drag = 0; rectCache = null; });
    window.addEventListener('resize', () => place());
}

/* ── переход к цитате: в ST это просто scrollIntoView ── */
export function jumpTo(q) {
    let mes = null;
    if (q.mesId != null) mes = document.querySelector(`#chat .mes[mesid="${q.mesId}"]`);
    if (!mes) {
        for (const el of document.querySelectorAll('#chat .mes_text')) {
            if (el.__cq && findRun(el.__cq, q.text) >= 0) { mes = el.closest('.mes'); break; }
        }
    }
    if (!mes) { toast('Сообщения нет на экране', 'warning'); return false; }
    const st = mes.querySelector('.mes_text')?.__cq;
    const at = st ? findRun(st, q.text) : -1;
    const target = at >= 0 ? firstSeg(st, at) : mes;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (st && at >= 0) {
        const L = norm(q.text).split(' ').length;
        let n = 0, on = false;
        const iv = setInterval(() => {
            on = !on;
            for (let i = at; i < at + L; i++) (st.WSEG[i] || []).forEach(el => el.style.outline = on ? '2px solid #a5714e' : '');
            if (++n >= 6) { clearInterval(iv); for (let i = at; i < at + L; i++) (st.WSEG[i] || []).forEach(el => el.style.outline = ''); }
        }, 250);
    }
    return true;
}
