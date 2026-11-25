/*
 * Full Tidy — плагін для Lampa
 * На сторінці фільму: ховає нижній дублікат опису (блок "Детально")
 * та піднімає кнопки Жанр / Виробництво / Теги під кнопки дій.
 */
(function () {
    'use strict';

    if (window.full_tidy_v3_plugin) return;
    window.full_tidy_v3_plugin = true;

    var DETAILS = ['Детально', 'Подробно', 'Details'];
    var TAG_RE = /^(Жанр|Жанри|Жанры|Виробництво|Производство|Теги|Тэги|Genres?|Production|Tags?)\s*\d*$/i;

    function trim(s) { return (s || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }

    function isVisible(el) {
        return !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0 ||
            (el.getClientRects && el.getClientRects().length > 0)));
    }

    function addStyle() {
        if ($('#fulltidy-style').length) return;
        $('<style id="fulltidy-style">' +
            '.fulltidy-tags{display:flex;flex-wrap:wrap;justify-content:center;gap:.6em;margin:1em 0 .5em}' +
        '</style>').appendTo('head');
    }

    // листовий елемент, текст якого точно збігається з одним зі списку
    function leafWithText(root, list) {
        var found = null;
        root.find('div,span,a,b,p,h1,h2,h3,h4,li,dt,dd,label').each(function () {
            var el = $(this);
            if (el.children().length) return;
            if (list.indexOf(trim(el.text())) > -1) { found = el; return false; }
        });
        return found;
    }

    function findButtonsBlock(root) {
        var b = root.find('.full-start-new__buttons, .full-start__buttons').first();
        if (b.length) return b;
        var btn = root.find('.button--play, .full-start__button, .full-start-new__button').first();
        return btn.length ? btn.parent() : null;
    }

    function tidy(root) {
        /* 1. Заголовок "Детально" */
        var head = leafWithText(root, DETAILS);
        if (head) {
            var hw = head.closest('.items-line__head, .full-descr__title');
            (hw.length ? hw : head).hide();
        }

        /* 2. Дублікат опису: другий видимий абзац з однаковим початком ховаємо */
        var seen = {};
        root.find('div,p,span').each(function () {
            var el = $(this);
            if (el.children().length) return;
            var t = trim(el.text());
            if (t.length < 60) return;
            if (!isVisible(this)) return;
            var key = t.slice(0, 60).toLowerCase();
            if (seen[key]) el.hide();
            else seen[key] = true;
        });

        /* 3. Жанр / Виробництво / Теги вище */
        var chips = root.find('.selector').filter(function () {
            return TAG_RE.test(trim($(this).text()));
        });
        if (chips.length) {
            var container = chips.first().parent();
            var target = findButtonsBlock(root);
            if (target && target.length && container[0] !== target[0] &&
                !$.contains(container[0], target[0]) && container.prev()[0] !== target[0]) {
                container.addClass('fulltidy-tags').insertAfter(target);
            }
        }
    }

    function run(root) {
        if (!root || !root.length) return;

        [0, 300, 900, 2000, 4000, 6000].forEach(function (ms) {
            setTimeout(function () {
                try { tidy(root); } catch (e) { console.log('[full-tidy]', e); }
            }, ms);
        });

        // якщо інший плагін перебудує розмітку, застосовуємо ще раз (до 15 с)
        try {
            var timer = null;
            var obs = new MutationObserver(function () {
                clearTimeout(timer);
                timer = setTimeout(function () {
                    try { tidy(root); } catch (e) {}
                }, 250);
            });
            obs.observe(root[0], { childList: true, subtree: true });
            setTimeout(function () { obs.disconnect(); clearTimeout(timer); }, 15000);
        } catch (e) {}
    }

    function init() {
        addStyle();
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite' && e.type !== 'complete') return;

            var root = null;
            try { root = e.object.activity.render(); } catch (x) {}
            if (!root) { try { root = Lampa.Activity.active().activity.render(); } catch (y) {} }

            run(root);
        });
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
