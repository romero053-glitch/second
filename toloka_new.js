/*
 * Toloka New — плагін для Lampa
 * Показує нові роздачі з RSS Toloka.to у вигляді карток (постери з TMDB).
 *
 * Налаштування: Налаштування → Toloka
 *   - RSS-посилання (за замовчуванням уже вказане)
 *   - Cookie (потрібна авторизація на сайті)
 *   - Проксі (потрібен у браузері/на ТВ без native-запитів)
 */
(function () {
    'use strict';

    if (window.toloka_new_plugin) return;
    window.toloka_new_plugin = true;

    var DEFAULT_RSS = 'https://toloka.to/rss.php?t=1&c=12&f=96&toronly=1&lite=1&thumbs=1';
    var CACHE_KEY = 'toloka_new_cache';
    var CACHE_MINUTES = 15;

    function S(key, def) {
        return Lampa.Storage.get(key, def);
    }

    function trim(s) {
        return (s || '').replace(/^\s+|\s+$/g, '');
    }

    /* ---------- Завантаження RSS ---------- */

    function buildUrl(url) {
        var proxy = trim(S('toloka_proxy', ''));
        if (!proxy) return url;
        if (proxy.indexOf('{url}') > -1) return proxy.replace('{url}', encodeURIComponent(url));
        return proxy + url;
    }

    function fetchRss() {
        return new Promise(function (resolve, reject) {
            var rss = trim(S('toloka_rss', '')) || DEFAULT_RSS;
            var cookie = trim(S('toloka_cookie', ''));
            var proxy = trim(S('toloka_proxy', ''));
            var net = new Lampa.Reguest();
            var headers = cookie ? { 'Cookie': cookie } : {};
            var target = buildUrl(rss);

            var ok = function (text) { resolve(typeof text === 'string' ? text : String(text)); };
            var fail = function (e) { reject(e || new Error('network')); };
            var opts = { dataType: 'text', headers: headers };

            // На Android native-запит вміє відправляти заголовок Cookie напряму
            if (Lampa.Platform.is('android') && !proxy) net.native(target, ok, fail, false, opts);
            else net.silent(target, ok, fail, false, opts);
        });
    }

    function parseRss(xml) {
        var doc = new DOMParser().parseFromString(xml, 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('not_xml');
        var items = [].slice.call(doc.querySelectorAll('item'));
        return items.map(function (it) {
            var get = function (n) {
                var e = it.querySelector(n);
                return e ? e.textContent : '';
            };
            return { title: get('title'), link: get('link'), date: get('pubDate') };
        });
    }

    /* ---------- Розбір назви роздачі ---------- */

    // "Назва / Original Name (2025) WEB-DL 1080p" -> { names: [...], year }
    function parseTitle(raw) {
        var t = (raw || '').replace(/\s+/g, ' ');
        var ym = t.match(/\((\d{4})\)/);
        var year = ym ? ym[1] : '';
        var head = t.split(/\s*\(\d{4}\)/)[0].replace(/\[.*?\]/g, '');
        var names = head.split(/\s\/\s/).map(trim).filter(Boolean);
        // спочатку оригінальна назва — TMDB знаходить її краще
        if (names.length > 1) names = names.slice(1).concat(names[0]);
        return { names: names, year: year };
    }

    /* ---------- Пошук у TMDB ---------- */

    function tmdbSearch(name, year, type) {
        return new Promise(function (resolve) {
            var yearParam = year ? (type === 'movie' ? '&year=' : '&first_air_date_year=') + year : '';
            var url = Lampa.TMDB.api(
                'search/' + type + '?api_key=' + Lampa.TMDB.key() +
                '&query=' + encodeURIComponent(name) + yearParam +
                '&language=' + (Lampa.Storage.field('tmdb_lang') || 'uk')
            );
            new Lampa.Reguest().silent(url, function (json) {
                resolve(json && json.results && json.results[0] ? json.results[0] : null);
            }, function () { resolve(null); });
        });
    }

    function resolveCard(info) {
        var tries = [];
        info.names.forEach(function (n) {
            tries.push([n, 'movie']);
            tries.push([n, 'tv']);
        });

        return tries.reduce(function (p, t) {
            return p.then(function (found) {
                if (found) return found;
                return tmdbSearch(t[0], info.year, t[1]).then(function (r) {
                    if (r) r.method = t[1];
                    return r;
                });
            });
        }, Promise.resolve(null));
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

    /* ---------- Основне завантаження зі списком карток ---------- */

    function load() {
        var cache = Lampa.Storage.get(CACHE_KEY, '{}');
        if (typeof cache === 'string') { try { cache = JSON.parse(cache); } catch (e) { cache = {}; } }
        if (cache.time && cache.list && (Date.now() - cache.time) < CACHE_MINUTES * 60000) {
            return Promise.resolve(cache.list);
        }

        return fetchRss().then(function (xml) {
            var items = parseRss(xml);
            var seen = {};
            var infos = [];

            items.forEach(function (it) {
                var info = parseTitle(it.title);
                if (!info.names.length) return;
                var key = (info.names[0] + '|' + info.year).toLowerCase();
                if (seen[key]) return;
                seen[key] = true;
                infos.push(info);
            });

            return inBatches(infos.slice(0, 40), 5, resolveCard);
        }).then(function (cards) {
            var uniq = {};
            var list = cards.filter(function (c) {
                if (!c || uniq[c.method + c.id]) return false;
                uniq[c.method + c.id] = true;
                return true;
            });

            Lampa.Storage.set(CACHE_KEY, JSON.stringify({ time: Date.now(), list: list }));
            return list;
        });
    }

    /* ---------- Компонент ---------- */

    function TolokaComponent(object) {
        var comp = new Lampa.InteractionCategory(object);

        comp.create = function () {
            var self = this;

            if (!trim(S('toloka_cookie', '')) && !trim(S('toloka_proxy', ''))) {
                Lampa.Noty.show('Toloka: вкажіть Cookie (або проксі) в Налаштування → Toloka');
            }

            load().then(function (list) {
                if (!list.length) {
                    Lampa.Noty.show('Toloka: нічого не знайдено. Перевірте авторизацію (Cookie).');
                    return self.empty();
                }
                self.build({ results: list, page: 1, total_pages: 1 });
            }).catch(function () {
                Lampa.Noty.show('Toloka: не вдалося завантажити RSS (Cookie/проксі/CORS)');
                self.empty();
            });
        };

        comp.nextPageReuest = function (obj, resolve) {
            resolve.call(comp, { results: [] });
        };

        comp.cardRender = function (obj, element, card) {
            card.onEnter = function () {
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

    /* ---------- Налаштування та пункт меню ---------- */

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'toloka',
            name: 'Toloka',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'toloka',
            param: { name: 'toloka_rss', type: 'input', values: '', default: DEFAULT_RSS },
            field: { name: 'RSS-посилання', description: 'Посилання на RSS Toloka' }
        });

        Lampa.SettingsApi.addParam({
            component: 'toloka',
            param: { name: 'toloka_cookie', type: 'input', values: '', default: '' },
            field: {
                name: 'Cookie',
                description: 'Cookie авторизованої сесії, напр. toloka_sid=...; toloka_data=... (з DevTools браузера після входу на toloka.to)'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'toloka',
            param: { name: 'toloka_proxy', type: 'input', values: '', default: '' },
            field: {
                name: 'Проксі (необов\'язково)',
                description: 'Префікс проксі або шаблон з {url}. Потрібен у браузері, де заборонено відправку Cookie'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'toloka',
            param: { name: 'toloka_clear', type: 'button' },
            field: { name: 'Очистити кеш', description: 'Натисніть, щоб оновити список' },
            onChange: function () {
                Lampa.Storage.set(CACHE_KEY, '{}');
                Lampa.Noty.show('Кеш Toloka очищено');
            }
        });
    }

    function addMenu() {
        var btn = $(
            '<li class="menu__item selector">' +
                '<div class="menu__ico"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg></div>' +
                '<div class="menu__text">Toloka</div>' +
            '</li>'
        );

        btn.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: 'Toloka — нові',
                component: 'toloka_new',
                page: 1
            });
        });

        $('.menu .menu__list').eq(0).append(btn);
    }

    function init() {
        Lampa.Component.add('toloka_new', TolokaComponent);
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
