/*
 * Rutor New — плагін для Lampa
 * Показує нові відео-роздачі з RSS rutor (постери з TMDB).
 * Налаштування: Налаштування → Rutor (RSS-посилання, проксі)
 */
(function () {
    'use strict';

    if (window.rutor_new_plugin) return;
    window.rutor_new_plugin = true;

    var DEFAULT_RSS = 'https://alt.rutor.info/rss.php?c';
    var CACHE_KEY = 'rutor_new_cache';
    var CACHE_MINUTES = 15;
    // які розділи показувати (поле <description> в RSS)
    var VIDEO_CATEGORY = /фильм|сериал|мульт|аним|документ/i;
    var SERIES_CATEGORY = /сериал/i;

    function S(key, def) {
        return Lampa.Storage.get(key, def);
    }

    function trim(s) {
        return (s || '').replace(/^\s+|\s+$/g, '');
    }

    /* ---------- Завантаження RSS ---------- */

    function buildUrl(url) {
        var proxy = trim(S('rutor_proxy', ''));
        if (!proxy) return url;
        if (proxy.indexOf('{url}') > -1) return proxy.replace('{url}', encodeURIComponent(url));
        return proxy + url;
    }

    function fetchRss() {
        return new Promise(function (resolve, reject) {
            var rss = trim(S('rutor_rss', '')) || DEFAULT_RSS;
            var proxy = trim(S('rutor_proxy', ''));
            var net = new Lampa.Reguest();
            var target = buildUrl(rss);

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

    // "Крик / Scream (1996) UHD BDRemux ... (file.torrent)" -> { names, year }
    function parseTitle(raw) {
        var t = (raw || '')
            .replace(/\s*\([^()]*\.torrent\)\s*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();

        var ym = t.match(/\((\d{4})\)/);
        var year = ym ? ym[1] : '';
        var head = t.split(/\s*\(\d{4}\)/)[0].replace(/\[.*?\]/g, '').trim();
        var names = head.split(/\s\/\s/).map(trim).filter(Boolean);

        // оригінальна назва першою — TMDB знаходить її краще
        if (names.length > 1) names = names.slice(1).concat(names[0]);

        // запасний варіант: частина до двокрапки ("Хождение по мукам: Сёстры")
        var extra = [];
        names.forEach(function (n) {
            var c = n.split(':')[0].trim();
            if (c && c !== n && c.length > 3) extra.push(c);
        });

        return { names: names.concat(extra), year: year };
    }

    /* ---------- Пошук у TMDB ---------- */

    function tmdbSearch(name, year, type) {
        return new Promise(function (resolve) {
            // для фільмів фільтруємо за роком; для серіалів ні (рік сезону ≠ рік виходу)
            var yearParam = (year && type === 'movie') ? '&year=' + year : '';
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

    function resolveCard(entry) {
        var info = entry.info;
        var types = entry.isSeries ? ['tv', 'movie'] : ['movie', 'tv'];
        var tries = [];

        info.names.forEach(function (n) {
            types.forEach(function (ty) { tries.push([n, ty]); });
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

    /* ---------- Основне завантаження ---------- */

    function load() {
        var cache = Lampa.Storage.get(CACHE_KEY, '{}');
        if (typeof cache === 'string') { try { cache = JSON.parse(cache); } catch (e) { cache = {}; } }
        if (cache.time && cache.list && (Date.now() - cache.time) < CACHE_MINUTES * 60000) {
            return Promise.resolve(cache.list);
        }

        return fetchRss().then(function (xml) {
            var items = parseRss(xml);
            var seen = {};
            var entries = [];

            items.forEach(function (it) {
                if (!VIDEO_CATEGORY.test(it.category)) return;
                var info = parseTitle(it.title);
                if (!info.names.length) return;
                var key = (info.names[0] + '|' + info.year).toLowerCase();
                if (seen[key]) return;
                seen[key] = true;
                entries.push({ info: info, isSeries: SERIES_CATEGORY.test(it.category) });
            });

            return inBatches(entries.slice(0, 40), 5, resolveCard);
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

    function RutorComponent(object) {
        var comp = new Lampa.InteractionCategory(object);

        comp.create = function () {
            var self = this;

            load().then(function (list) {
                if (!list.length) {
                    Lampa.Noty.show('Rutor: нічого не знайдено');
                    return self.empty();
                }
                self.build({ results: list, page: 1, total_pages: 1 });
            }).catch(function () {
                Lampa.Noty.show('Rutor: не вдалося завантажити RSS (потрібен проксі?)');
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

    /* ---------- Налаштування та меню ---------- */

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
                    Lampa.Storage.set(CACHE_KEY, '{}');
                    Lampa.Noty.show(title + ': збережено');
                    try { Lampa.Controller.toggle('settings_component'); } catch (e) {}
                });
            }
        });
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'rutor',
            name: 'Rutor',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16M4 12h16M4 19h10"/></svg>'
        });

        addTextSetting(
            'rutor_rss',
            'RSS-посилання',
            'Необов\'язково. За замовчуванням: ' + DEFAULT_RSS + ' (змініть, якщо дзеркало не відкривається)'
        );

        addTextSetting(
            'rutor_proxy',
            'Проксі',
            'Необов\'язково. Шаблон з {url}, потрібен, якщо сайт не відкривається напряму або блокує CORS'
        );

        Lampa.SettingsApi.addParam({
            component: 'rutor',
            param: { name: 'rutor_clear', type: 'button' },
            field: { name: 'Очистити кеш', description: 'Натисніть, щоб оновити список' },
            onChange: function () {
                Lampa.Storage.set(CACHE_KEY, '{}');
                Lampa.Noty.show('Кеш Rutor очищено');
            }
        });
    }

    function addMenu() {
        var btn = $(
            '<li class="menu__item selector">' +
                '<div class="menu__ico"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16M4 12h16M4 19h10"/></svg></div>' +
                '<div class="menu__text">Rutor</div>' +
            '</li>'
        );

        btn.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: 'Rutor — нові',
                component: 'rutor_new',
                page: 1
            });
        });

        $('.menu .menu__list').eq(0).append(btn);
    }

    function init() {
        Lampa.Component.add('rutor_new', RutorComponent);
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
