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
    // 'after-year' = одразу після року, 'end' = у кінці рядка (після рейтингу)
    var COUNTRY_PLACE = 'after-year';

    var DETAILS = ['Детально', 'Подробно', 'Details'];
    var COUNTRIES = ['Країни', 'Країна', 'Страны', 'Страна', 'Countries', 'Country'];
    var TAG_RE = /^(Жанр|Жанри|Жанры|Виробництво|Производство|Теги|Тэги|Genres?|Production|Tags?)\s*\d*$/i;

    function trim(s) { return (s || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }

    function isVisible(el) {
        return !!(el && (el.offsetWidth > 0 || el.offsetHeight > 0 || (el.getClientRects && el.getClientRects().length > 0)));
    }

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
        root.find('div,span,a,b,p,h1,h2,h3,h4,li,dt,dd,label').each(function () {
            var el = $(this);
            if (el.children().length) return;
            var t = trim(el.text()).replace(/:$/, '');
            if (list.indexOf(t) > -1) { found = el; return false; }
        });
        return found;
    }

    // рік виходу: лише ВИДИМИЙ листовий елемент
    function findYearEl(root) {
        var found = null;
        root.find('div,span').each(function () {
            var el = $(this);
            if (el.children().length) return;
            if (el.closest('.full-descr').length) return;
            if (!/^(19|20)\d{2}$/.test(trim(el.text()))) return;
            if (!isVisible(this)) return;
            found = el;
            return false;
        });
        return found;
    }

    function findButtonsBlock(root) {
        var b = root.find('.full-start-new__buttons, .full-start__buttons').first();
        if (b.length) return b;
        var btn = root.find('.button--play, .full-start__button, .full-start-new__button').first();
        return btn.length ? btn.parent() : null;
    }

    // країни з даних TMDB (запасний варіант)
    function countriesFromData(movie) {
        if (!movie) return [];
        var dn = null;
        try { dn = new Intl.DisplayNames(['uk'], { type: 'region' }); } catch (e) {}

        function name(code, fallback) {
            if (code === 'US') return 'США';
            if (dn && code) { try { return dn.of(code); } catch (e) {} }
            return fallback || code || '';
        }

        var list = movie.production_countries || [];
        var out = list.map(function (c) { return name(c.iso_3166_1 || c.iso, c.name); });

        if (!out.length && movie.origin_country && movie.origin_country.length) {
            out = movie.origin_country.map(function (code) { return name(code, code); });
        }
        return out.filter(Boolean);
    }

    function tidy(root, movie) {
        var res = { year: false, tags: false, details: false, country: false };

        /* 1. "Детально" та опис */
        var head = leafWithText(root, DETAILS);
        if (head) {
            var hw = head.closest('.items-line__head, .full-descr__title');
            (hw.length ? hw : head).hide();
            res.details = true;
        }
        root.find('.full-descr__text').hide();
        root.find('.full-descr').find('div,p,span').filter(function () {
            var el = $(this);
            return !el.children().length && trim(el.text()).length > 80;
        }).hide();

        /* 2. Країни поруч із видимим роком */
        root.find('.fulltidy-country').each(function () {
            if (!isVisible(this)) $(this).remove(); // зі схованих рядків прибираємо
        });

        var yearEl = findYearEl(root);
        res.year = !!yearEl;

        if (yearEl) {
            if (root.find('.fulltidy-country').length) {
                res.country = true;
            } else {
                var text = '';
                var block = null;

                var label = leafWithText(root, COUNTRIES);
                if (label && isVisible(label[0])) {
                    block = label.parent();
                    text = trim(label.next().text()) ||
                        trim(block.text().replace(trim(label.text()), ''));
                }
                if (!text) {
                    var m = movie;
                    if (!m) { try { m = Lampa.Activity.active().card; } catch (e) {} }
                    text = countriesFromData(m).join(', ');
                }

                if (text) {
                    text = text.split(/\s*,\s*/).slice(0, MAX_COUNTRIES).join(', ');
                    var span = $('<span class="fulltidy-country"></span>')
                        .addClass(yearEl.attr('class') || '')
                        .text(text);

                    if (COUNTRY_PLACE === 'end') yearEl.parent().append(span);
                    else yearEl.after(span);

                    if (block) block.hide();
                    res.country = true;
                }
            }
        }

        /* 3. Жанр / Виробництво / Теги вище */
        var chips = root.find('.selector').filter(function () {
            return TAG_RE.test(trim($(this).text()));
        });
        if (chips.length) {
            var container = chips.first().parent();
            var target = findButtonsBlock(root) || (yearEl ? yearEl.parent() : null);
            if (target && target.length && container[0] !== target[0] && !$.contains(container[0], target[0])) {
                if (container.prev()[0] !== target[0]) {
                    container.addClass('fulltidy-tags').insertAfter(target);
                }
                res.tags = true;
            }
        }

        return res;
    }

    function run(root, movie) {
        if (!root || !root.length) return;

        var delays = [0, 300, 900, 2000, 4000, 6000];
        delays.forEach(function (ms, i) {
            setTimeout(function () {
                try {
                    var r = tidy(root, movie);
                    if (i === delays.length - 1 && (!r.year || !r.tags || !r.country)) {
                        console.log('[full-tidy] не знайдено:', JSON.stringify(r));
                        Lampa.Noty.show('Full Tidy: не знайдено — ' +
                            (r.year ? '' : 'рік; ') + (r.country ? '' : 'країни; ') + (r.tags ? '' : 'кнопки жанрів'));
                    }
                } catch (e) { console.log('[full-tidy]', e); }
            }, ms);
        });

        // якщо інший плагін перебудує розмітку, застосовуємо ще раз (до 15 с)
        try {
            var timer = null;
            var obs = new MutationObserver(function () {
                clearTimeout(timer);
                timer = setTimeout(function () {
                    try { tidy(root, movie); } catch (e) {}
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

            var movie = null;
            try { movie = (e.data && e.data.movie) || (e.object && e.object.card) || null; } catch (z) {}

            run(root, movie);
        });
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
