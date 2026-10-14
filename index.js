// bookmark⋆⭒˚.⋆: расширение больше не поддерживается и отключено.
const MSG = "Расширение «bookmark⋆⭒˚.⋆» больше не поддерживается автором и отключено. Его можно удалить: Расширения → Управление расширениями → значок корзины. Чаты и персонажи не пострадают.";
const MSG_EN = "This extension is no longer supported and has been turned off. You can uninstall it in Extensions \u2192 Manage extensions.";
const KEY = "farewell:bookmark-sillytavern";
console.warn('[' + KEY + '] ' + MSG);
let shown = false;
try { shown = localStorage.getItem(KEY) === '1'; } catch (e) {}
if (!shown) {
    setTimeout(() => {
        try { toastr.info(MSG + '<br><br>' + MSG_EN, '', { timeOut: 0, extendedTimeOut: 0, closeButton: true, escapeHtml: false }); } catch (e) {}
        try { localStorage.setItem(KEY, '1'); } catch (e) {}
    }, 3000);
}
