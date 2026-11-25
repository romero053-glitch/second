/*
 * Rutor v3 — плагін для Lampa
 * Нові відео-роздачі з RSS Rutor, кілька джерел у вигляді вкладок.
 * Налаштування: Налаштування → Rutor (дзеркало, проксі)
 *
 * Щоб додати вкладку, допишіть рядок у SOURCES нижче.
 */
(function () {
    'use strict';

    if (window.rutor_v3_plugin) return;
    window.rutor_v3_plugin = true;

    var DEFAULT_HOST = 'alt.rutor.info';
    var CACHE_MINUTES = 15;
    var VIDEO_CATEGORY = /фильм|сериал|мульт|аним|документ/i;
    var SERIES_CATEGORY = /сериал/i;
    // маркери серіалу в назві: [S01], [01x01-09 из 12], [01-10 из 12]
    var SERIES_TITLE = /\[\s*(?:S\d+|\d+\s*[xхXХ]\s*\d+|\d+\s*-\s*\d+\s*из)/i;

    // {host} підставляється з налаштування "Дзеркало"
    // any: true = брати всі записи стрічки (без фільтра за розділом)
    // series: true = усі записи вважати серіалами
    var SOURCES = [
        { id: 'foreign', name: 'Іноземні фільми', url: 'https://{host}/rss.php?category=1', any: true },
        { id: 'series', name: 'Іноземні серіали', url: 'https://{host}/rss.php?category=4', any: true, series: true },
        { id: 'cartoons', name: 'Мультиплікація', url: 'https://{host}/rss.php?category=7', any: true },
        { id: 'anime', name: 'Аніме', url: 'https://{host}/rss.php?category=10', any: true },
        { id: 'all', name: 'Усе', url: 'https://{host}/rss.php?c' }
    ];

    function S(key, def) { return Lampa.Storage.get(key, def); }
    function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }

    function sourceById(id) {
        return SOURCES.filter(function (s) { return s.id === id; })[0] || SOURCES[0];
    }

    /* ---------- Завантаження RSS ---------- */

    function sourceUrl(source) {
        var host = trim(S('rutor_host', '')) || DEFAULT_HOST;
        return source.url.replace('{host}', host);
    }

    function buildUrl(url) {
        var proxy = trim(S('rutor_proxy', ''));
        if (!proxy) return url;
        if (proxy.indexOf('{url}') > -1) return proxy.replace('{url}', encodeURIComponent(url));
        return proxy + url;
    }

    function fetchRss(url) {
        return new Promise(function (resolve, reject) {
            var proxy = trim(S('rutor_proxy', ''));
            var net = new Lampa.Reguest();
            var target = buildUrl(url);

            var ok = function (text) { resolve(typeof text === 'string' ? text : String(text)); };
            var fail = function (e) { reject(e || new Error('network')); };
            var opts = { dataType: 'text' };

            if (Lampa.Platform.is('android') && !proxy) net.native(target, ok, fail, false, opts);
            else net.silent(target, ok, fail, false, opts);
        });
    }

    function decode(s) {
        return (s || '')
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }

    function parseRss(xml) {
        var blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        return blocks.map(function (b) {
            var get = function (tag) {
                var m = b.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
                return m ? decode(m[1]) : '';
            };
            return { title: get('title'), category: get('description'), link: get('link') };
        });
    }

    /* ---------- Розбір назви роздачі ---------- */

    // "Крик / Scream (1996) UHD BDRemux ..." -> { names, year, ru }
    function parseTitle(raw) {
        var t = (raw || '')
            .replace(/\s*\([^()]*\.torrent\)\s*$/i, '')
            .replace(/\s+/g, ' ')
            .replace(/^\s+|\s+$/g, '');

        var YEAR = '\\((\\d{4})(?:\\s*-\\s*\\d{4})?\\)';
        var ym = t.match(new RegExp(YEAR));
        var year = ym ? ym[1] : '';

        var head = t.split(new RegExp('\\s*' + YEAR))[0].replace(/\[.*?\]/g, '').replace(/^\s+|\s+$/g, '');
        var all = head.split(/\s\/\s/).map(trim).filter(Boolean);
        var ru = all[0] || head;

        // остання (зазвичай англійська) назва першою: TMDB знаходить її найкраще
        var names = all.slice().reverse();

        // запасний варіант: частина до двокрапки ("Хождение по мукам: Сёстры")
        var extra = [];
        names.forEach(function (n) {
            var c = n.split(':')[0].replace(/^\s+|\s+$/g, '');
            if (c && c !== n && c.length > 3) extra.push(c);
        });

        return { names: names.concat(extra), year: year, ru: ru };
    }

    /* ---------- Пошук у TMDB ---------- */

    function itemYear(r) {
        var d = r.release_date || r.first_air_date || '';
        return parseInt(d.slice(0, 4), 10) || 0;
    }

    // withYear = true: фільтр за роком у запиті (лише для фільмів).
    // withYear = false: без фільтра, але беремо результат з роком ±1.
    function tmdbSearch(name, year, type, withYear) {
        return new Promise(function (resolve) {
            var yearParam = (withYear && year && type === 'movie') ? '&year=' + year : '';
            var url = Lampa.TMDB.api(
                'search/' + type + '?api_key=' + Lampa.TMDB.key() +
                '&query=' + encodeURIComponent(name) + yearParam +
                '&language=' + (Lampa.Storage.field('tmdb_lang') || 'uk')
            );
            new Lampa.Reguest().silent(url, function (json) {
                var results = (json && json.results) || [];
                if (!withYear && year && type === 'movie') {
                    var y = parseInt(year, 10);
                    results = results.filter(function (r) { return Math.abs(itemYear(r) - y) <= 1; });
                }
                resolve(results[0] || null);
            }, function () { resolve(null); });
        });
    }

    function fallbackCard(info) {
        var name = info.ru || info.names[0] || '';
        var hash = 0;
        for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
        return {
            id: 'rutor_' + Math.abs(hash),
            title: name,
            original_title: name,
            release_date: info.year ? info.year + '-01-01' : '',
            poster_path: null,
            backdrop_path: null,
            vote_average: 0,
            method: 'movie',
            rutor_fake: true
        };
    }

    function infoCard(text) {
        return {
            id: 'rutor_info',
            title: text,
            original_title: text,
            release_date: '',
            poster_path: null,
            backdrop_path: null,
            vote_average: 0,
            method: 'movie',
            rutor_fake: true,
            rutor_info: true
        };
    }

    function resolveCard(entry) {
        var info = entry.info;
        var types = entry.isSeries ? ['tv', 'movie'] : ['movie', 'tv'];
        var tries = [];

        [true, false].forEach(function (withYear) {
            info.names.forEach(function (n) {
                types.forEach(function (ty) { tries.push([n, ty, withYear]); });
            });
        });

        return tries.reduce(function (p, t) {
            return p.then(function (found) {
                if (found) return found;
                return tmdbSearch(t[0], info.year, t[1], t[2]).then(function (r) {
                    if (r) r.method = t[1];
                    return r;
                });
            });
        }, Promise.resolve(null)).then(function (card) {
            return card || fallbackCard(info);
        });
    }

    function inBatches(list, size, fn) {
        var out = [];
        var chain = Promise.resolve();
        for (var i = 0; i < list.length; i += size) {
            (function (chunk) {
                chain = chain.then(function () {
                    return Promise.all(chunk.map(fn)).then(function (r) { out = out.concat(r); });
                });
            })(list.slice(i, i + size));
        }
        return chain.then(function () { return out; });
    }

    /* ---------- Завантаження списку для джерела ---------- */

    function cacheKey(source) { return 'rutor_cache_' + source.id; }

    function load(source) {
        var cache = Lampa.Storage.get(cacheKey(source), '{}');
        if (typeof cache === 'string') { try { cache = JSON.parse(cache); } catch (e) { cache = {}; } }
        if (cache.time && cache.list && (Date.now() - cache.time) < CACHE_MINUTES * 60000) {
            return Promise.resolve(cache.list);
        }

        var total = 0;

        return fetchRss(sourceUrl(source)).then(function (xml) {
            var items = parseRss(xml);
            total = items.length;
            var seen = {};
            var entries = [];

            items.forEach(function (it) {
                if (!source.any && !VIDEO_CATEGORY.test(it.category)) return;

                var info = parseTitle(it.title);
                if (!info.names.length) return;

                var key = (info.names[0] + '|' + info.year).toLowerCase();
                if (seen[key]) return;
                seen[key] = true;

                var isSeries = !!source.series || SERIES_CATEGORY.test(it.category) || SERIES_TITLE.test(it.title);
                entries.push({ info: info, isSeries: isSeries });
            });

            return inBatches(entries.slice(0, 40), 5, resolveCard);
        }).then(function (cards) {
            var uniq = {};
            var list = cards.filter(function (c) {
                if (!c || uniq[c.method + c.id]) return false;
                uniq[c.method + c.id] = true;
                return true;
            });

            var found = list.filter(function (c) { return !c.rutor_fake; }).length;
            Lampa.Noty.show('Rutor «' + source.name + '»: у RSS ' + total + ', карток ' + list.length + ' (з постером ' + found + ')');

            Lampa.Storage.set(cacheKey(source), JSON.stringify({ time: Date.now(), list: list }));
            return list;
        });
    }

    /* ---------- Компонент з вкладками ---------- */

    function openSource(id) {
        var s = sourceById(id);
        var params = { url: '', title: 'Rutor — ' + s.name, component: 'rutor_tabs', page: 1, rutor_source: id };
        if (Lampa.Activity.replace) Lampa.Activity.replace(params);
        else Lampa.Activity.push(params);
    }

    function RutorComponent(object) {
        var comp = new Lampa.InteractionCategory(object);
        var source = sourceById(object.rutor_source);
        var tabs = null;
        var focusedOnce = false;
        var origStart = comp.start;

        function buildTabs() {
            tabs = $('<div class="rutor-tabs"></div>');
            SOURCES.forEach(function (s) {
                var tab = $('<div class="rutor-tab selector"></div>')
                    .text(s.name)
                    .toggleClass('rutor-tab--active', s.id === source.id);
                tab.on('hover:enter', function () {
                    if (s.id !== source.id) openSource(s.id);
                });
                tabs.append(tab);
            });
        }

        function injectTabs() {
            buildTabs();
            var r = comp.render();
            var body = r.find('.scroll__body').first();
            if (body.length) body.prepend(tabs);
            else r.prepend(tabs);
        }

        comp.create = function () {
            var self = this;

            load(source).then(function (list) {
                if (!list.length) list = [infoCard('Нічого не знайдено')];
                self.build({ results: list, page: 1, total_pages: 1 });
                injectTabs();
            }).catch(function () {
                Lampa.Noty.show('Rutor: не вдалося завантажити RSS (потрібен проксі?)');
                self.build({ results: [infoCard('Не вдалося завантажити')], page: 1, total_pages: 1 });
                injectTabs();
            });
        };

        comp.start = function () {
            origStart.apply(this, arguments);
            // при першому відкритті ставимо фокус на активну вкладку
            if (!focusedOnce && tabs) {
                focusedOnce = true;
                var active = tabs.find('.rutor-tab--active')[0];
                if (active) {
                    setTimeout(function () {
                        try { Lampa.Controller.collectionFocus(active, comp.render()); } catch (e) {}
                    }, 50);
                }
            }
        };

        comp.nextPageReuest = function (obj, resolve) {
            resolve.call(comp, { results: [] });
        };

        comp.cardRender = function (obj, element, card) {
            card.onEnter = function () {
                if (element.rutor_info) {
                    Lampa.Noty.show(element.title);
                    return;
                }
                // запис, якого немає в TMDB: відкриваємо пошук Lampa за назвою
                if (element.rutor_fake) {
                    try {
                        if (Lampa.Search && Lampa.Search.open) {
                            Lampa.Search.open({ input: element.title });
                            return;
                        }
                    } catch (e) {}
                    Lampa.Noty.show(element.title + (element.release_date ? ' (' + element.release_date.slice(0, 4) + ')' : ''));
                    return;
                }

                Lampa.Activity.push({
                    url: '',
                    component: 'full',
                    id: element.id,
                    method: element.method || (element.name ? 'tv' : 'movie'),
                    card: element,
                    source: 'tmdb'
                });
            };
        };

        return comp;
    }

    /* ---------- Налаштування та меню ---------- */

    function addStyle() {
        if ($('#rutor-v3-style').length) return;
        $('<style id="rutor-v3-style">' +
            '.rutor-tabs{display:flex;flex-wrap:wrap;gap:.8em;padding:.5em 1.5em 1.2em}' +
            '.rutor-tab{padding:.5em 1.2em;border-radius:2em;background:rgba(255,255,255,.1);font-size:1.1em}' +
            '.rutor-tab--active{background:rgba(255,255,255,.35);font-weight:600}' +
            '.rutor-tab.focus{background:#fff;color:#000}' +
        '</style>').appendTo('head');
    }

    function clearCache() {
        SOURCES.forEach(function (s) { Lampa.Storage.set(cacheKey(s), '{}'); });
    }

    function addTextSetting(storageKey, title, description) {
        Lampa.SettingsApi.addParam({
            component: 'rutor',
            param: { name: storageKey + '_btn', type: 'button' },
            field: { name: title, description: description },
            onChange: function () {
                Lampa.Input.edit({
                    free: true,
                    title: title,
                    nosave: true,
                    value: S(storageKey, '') || ''
                }, function (val) {
                    Lampa.Storage.set(storageKey, trim(val));
                    clearCache();
                    Lampa.Noty.show(title + ': збережено');
                    try { Lampa.Controller.toggle('settings_component'); } catch (e) {}
                });
            }
        });
    }

    var ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16M4 12h16M4 19h10"/></svg>';

    function addSettings() {
        Lampa.SettingsApi.addComponent({ component: 'rutor', name: 'Rutor', icon: ICON });

        addTextSetting(
            'rutor_host',
            'Дзеркало',
            'Необов\'язково. Домен Rutor, за замовчуванням ' + DEFAULT_HOST + ' (напр. rutor.info)'
        );

        addTextSetting(
            'rutor_proxy',
            'Проксі',
            'Необов\'язково. Шаблон з {url}, потрібен, якщо сайт не відкривається напряму або блокує CORS'
        );

        Lampa.SettingsApi.addParam({
            component: 'rutor',
            param: { name: 'rutor_clear', type: 'button' },
            field: { name: 'Очистити кеш', description: 'Натисніть, щоб оновити всі вкладки' },
            onChange: function () {
                clearCache();
                Lampa.Noty.show('Кеш Rutor очищено');
            }
        });
    }

    function addMenu() {
        var btn = $(
            '<li class="menu__item selector">' +
                '<div class="menu__ico">' + ICON + '</div>' +
                '<div class="menu__text">Rutor</div>' +
            '</li>'
        );

        btn.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: 'Rutor — ' + SOURCES[0].name,
                component: 'rutor_tabs',
                page: 1,
                rutor_source: SOURCES[0].id
            });
        });

        $('.menu .menu__list').eq(0).append(btn);
    }

    function init() {
        addStyle();
        Lampa.Component.add('rutor_tabs', RutorComponent);
        addSettings();
        addMenu();
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
