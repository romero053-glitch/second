/*
 * Full Tidy — плагін для Lampa
 * На сторінці фільму: ховає блок "Детально" з описом, переносить країни
 * до року виходу та піднімає кнопки Жанр / Виробництво / Теги.
 */
(function () {
    'use strict';

    if (window.full_tidy_plugin) return;
    window.full_tidy_plugin = true;

    var MAX_COUNTRIES = 3;

    var DETAILS = ['Детально', 'Подробно', 'Details'];
    var COUNTRIES = ['Країни', 'Країна', 'Страны', 'Страна', 'Countries', 'Country'];
    var TAG_RE = /^(Жанр|Жанри|Жанры|Виробництво|Производство|Теги|Тэги|Genres?|Production|Tags?)\s*\d*$/i;

    function trim(s) { return (s || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }

    function addStyle() {
        if ($('#fulltidy-style').length) return;
        $('<style id="fulltidy-style">' +
            '.fulltidy-country{margin-left:.9em}' +
            '.fulltidy-tags{display:flex;flex-wrap:wrap;justify-content:center;gap:.6em;margin:1em 0 .5em}' +
        '</style>').appendTo('head');
    }

    // листовий елемент, текст якого точно збігається з одним зі списку
    function leafWithText(root, list) {
        var found = null;
        root.find('div,span,a,b,p,h1,h2,h3,h4').each(function () {
            var el = $(this);
            if (el.children().length) return;
            if (list.indexOf(trim(el.text())) > -1) { found = el; return false; }
        });
        return found;
    }

    function findYearEl(root) {
        var found = null;
        root.find('div,span').each(function () {
            var el = $(this);
            if (el.children().length) return;
            if (el.closest('.full-descr').length) return;
            if (/^(19|20)\d{2}$/.test(trim(el.text()))) { found = el; return false; }
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
        var res = { year: false, tags: false, details: false };

        /* 1. "Детально" та опис */
        var head = leafWithText(root, DETAILS);
        if (head) {
            var hw = head.closest('.items-line__head, .full-descr__title');
            (hw.length ? hw : head).hide();
            res.details = true;
        }
        root.find('.full-descr__text').hide();
        // запасний варіант: довгі текстові блоки всередині .full-descr
        root.find('.full-descr').find('div,p,span').filter(function () {
            var el = $(this);
            return !el.children().length && trim(el.text()).length > 80;
        }).hide();

        /* 2. Країни поруч із роком */
        var yearEl = findYearEl(root);
        if (yearEl && !root.find('.fulltidy-country').length) {
            var label = leafWithText(root, COUNTRIES);
            if (label) {
                var block = label.parent();
                var value = trim(label.next().text()) ||
                    trim(block.text().replace(trim(label.text()), ''));
                if (value) {
                    var text = value.split(/\s*,\s*/).slice(0, MAX_COUNTRIES).join(', ');
                    var span = $('<span class="fulltidy-country"></span>')
                        .addClass(yearEl.attr('class') || '')
                        .text(text);
                    yearEl.after(span);
                    block.hide();
                }
            }
        }
        res.year = !!yearEl;

        /* 3. Жанр / Виробництво / Теги вище */
        var chips = root.find('.selector').filter(function () {
            return TAG_RE.test(trim($(this).text()));
        });
        if (chips.length) {
            var container = chips.first().parent();
            var target = findButtonsBlock(root) || (yearEl ? yearEl.parent() : null);
            if (target && target.length && container[0] !== target[0] && !$.contains(container[0], target[0])) {
                container.addClass('fulltidy-tags').insertAfter(target);
                res.tags = true;
            }
        }

        return res;
    }

    function run(root) {
        if (!root || !root.length) return;
        var delays = [0, 300, 900, 2000, 4000];
        delays.forEach(function (ms, i) {
            setTimeout(function () {
                try {
                    var r = tidy(root);
                    if (i === delays.length - 1 && (!r.year || !r.tags)) {
                        console.log('[full-tidy] не знайдено:', JSON.stringify(r));
                        Lampa.Noty.show('Full Tidy: не всі елементи знайдено (' +
                            (r.year ? '' : 'рік ') + (r.tags ? '' : 'кнопки жанрів') + ')');
                    }
                } catch (e) { console.log('[full-tidy]', e); }
            }, ms);
        });
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
