(function () {
    'use strict';

    if (window.plugin_tmdb_posters_slideshow) return;
    window.plugin_tmdb_posters_slideshow = true;

    var TMDB_API_KEY = '2556f3c34d07b68f8eb2746f95d200cd'; // https://www.themoviedb.org/settings/api
    var PAGES = 3;            // скільки сторінок TMDB тягнути (по 20 позицій)
    var AUTOPLAY_MS = 10000;  // інтервал автоперемикання
    var POSTER_SIZE = 'w780'; // w500 / w780 / original
    var BACKDROP_SIZE = 'w1280';

    var genres = {};
    var lastError = '';

    /* ---------- Налаштування (зберігаються в Lampa.Storage) ---------- */

    function homeEnabled() {
        return String(Lampa.Storage.get('tps_home', 'true')) !== 'false';
    }

    function homePeriod() {
        return String(Lampa.Storage.get('tps_period', 'day')) === 'week' ? 'week' : 'day';
    }

    /* ---------- TMDB ---------- */

    function lang() {
        return Lampa.Storage.get('tmdb_lang', Lampa.Storage.get('language', 'uk'));
    }

    function imgUrl(size, path) {
        try {
            return Lampa.TMDB.image('t/p/' + size + path);
        } catch (e) {
            return 'https://image.tmdb.org/t/p/' + size + path;
        }
    }

    function apiGet(path, cb) {
        var url = Lampa.TMDB.api(path);
        if (url.indexOf('api_key=') === -1) {
            var key = TMDB_API_KEY;
            if (!key) { try { key = Lampa.TMDB.key(); } catch (e) {} }
            url += (url.indexOf('?') === -1 ? '?' : '&') + 'api_key=' + key;
        }
        var req = new Lampa.Reguest();
        req.silent(url, function (json) {
            cb(json);
        }, function (err, text) {
            try {
                lastError = (err && (err.status || err.statusText)) ? (err.status + ' ' + (err.statusText || '')) : (text || 'мережева помилка');
            } catch (e) { lastError = 'мережева помилка'; }
            console.log('TMDB posters: помилка запиту', url.replace(/api_key=[^&]+/, 'api_key=***'), err, text);
            cb(null);
        });
    }

    function loadGenres(done) {
        var left = 2;
        function fin() { if (--left === 0) done(); }
        ['movie', 'tv'].forEach(function (t) {
            apiGet('genre/' + t + '/list?language=' + lang(), function (json) {
                if (json && json.genres) {
                    json.genres.forEach(function (g) { genres[g.id] = g.name; });
                }
                fin();
            });
        });
    }

    function loadTrending(period, done) {
        var left = PAGES, all = [];
        for (var p = 1; p <= PAGES; p++) {
            (function (page) {
                apiGet('trending/all/' + period + '?language=' + lang() + '&page=' + page, function (json) {
                    all[page - 1] = json && json.results ? json.results : [];
                    if (--left === 0) {
                        var flat = [];
                        all.forEach(function (arr) { flat = flat.concat(arr || []); });
                        flat = flat.filter(function (m) {
                            return m.poster_path && m.media_type !== 'person';
                        });
                        done(flat);
                    }
                });
            })(p);
        }
    }

    // жанри + список трендів
    function prepare(period, done) {
        lastError = '';
        function go() { loadTrending(period, done); }
        if (Object.keys(genres).length) go(); else loadGenres(go);
    }

    /* ---------- Відображення ---------- */

    function esc(s) {
        return String(s || '').replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function ratingColor(v) {
        if (v >= 70) return '#21d07a';
        if (v >= 40) return '#d2d531';
        return '#db2360';
    }

    /* ---------- Логотипи фільмів ---------- */

    var LOGO_LANGS = ['uk', 'en']; // мови логотипів за пріоритетом; додайте 'en', щоб показувати англійські, якщо українського немає
    var logoCache = {};

    function pickLogo(list) {
        for (var i = 0; i < LOGO_LANGS.length; i++) {
            var lg = LOGO_LANGS[i];
            var found = list.filter(function (l) { return l.iso_639_1 === lg; });
            if (found.length) {
                found.sort(function (a, b) { return (b.vote_average || 0) - (a.vote_average || 0); });
                return found[0];
            }
        }
        return null;
    }

    function loadLogo(m, cb) {
        var type = m.media_type === 'tv' ? 'tv' : 'movie';
        var key = type + m.id;
        if (key in logoCache) { cb(logoCache[key]); return; }
        apiGet(type + '/' + m.id + '/images?include_image_language=' + LOGO_LANGS.join(',') + ',null', function (json) {
            var url = null;
            if (json && json.logos && json.logos.length) {
                var p = pickLogo(json.logos);
                if (p) url = imgUrl(/\.svg$/i.test(p.file_path) ? 'original' : 'w500', p.file_path);
            }
            logoCache[key] = url;
            cb(url);
        });
    }

    function metaText(m, withYear) {
        var date = m.release_date || m.first_air_date || '';
        var year = date ? date.slice(0, 4) : '';
        var parts = [];
        if (withYear && year) parts.push(year);
        parts.push(m.media_type === 'tv' ? 'Серіал' : 'Фільм');
        var gl = (m.genre_ids || []).map(function (id) { return genres[id]; }).filter(Boolean).join(', ');
        if (gl) parts.push(gl);
        return parts.join(' • ');
    }

    function contentHtml(m) {
        var title = m.title || m.name || '';
        var date = m.release_date || m.first_air_date || '';
        var year = date ? date.slice(0, 4) : '';
        var type = m.media_type === 'tv' ? 'Серіал' : 'Фільм';
        var pct = Math.round((m.vote_average || 0) * 10);
        var gl = (m.genre_ids || []).map(function (id) { return genres[id]; }).filter(Boolean).join(', ');

        var meta = [type];
        if (gl) meta.push(gl);

        return '' +
            '<div class="tps-poster"><img src="' + imgUrl(POSTER_SIZE, m.poster_path) + '" /></div>' +
            '<div class="tps-info">' +
                '<div class="tps-title">' + esc(title) + (year ? ' <span class="tps-year">(' + year + ')</span>' : '') + '</div>' +
                '<div class="tps-meta">' + esc(meta.join(' • ')) + '</div>' +
                (m.vote_count ? '<div class="tps-rate">' +
                    '<div class="tps-circle" style="border-color:' + ratingColor(pct) + '">' + pct + '<span>%</span></div>' +
                    '<div class="tps-ratetext">Оцінка<br>користувачів</div>' +
                '</div>' : '') +
                (m.overview ? '<div class="tps-overview-title">Опис</div><div class="tps-overview">' + esc(m.overview) + '</div>' : '') +
            '</div>';
    }

    function preload(m) {
        if (!m) return;
        var im = new Image(); im.src = imgUrl(POSTER_SIZE, m.poster_path);
        if (m.backdrop_path) { var bi = new Image(); bi.src = imgUrl(BACKDROP_SIZE, m.backdrop_path); }
    }

    /* Слайдер: малює у root, нічого не знає про контролери Lampa */
    function createSlider(root, items, onOpen) {
        root.html(
            '<div class="tps-bg"></div>' +
            '<div class="tps-shade"></div>' +
            '<div class="tps-content"></div>' +
            '<div class="tps-counter"></div>' +
            '<div class="tps-hint"></div>'
        );

        var bg = root.find('.tps-bg');
        var content = root.find('.tps-content');
        var counter = root.find('.tps-counter');
        var hint = root.find('.tps-hint');

        var s = { index: 0, playing: true, timer: null, hintTimer: null, token: 0, dead: false };

        function n() { return items.length; }

        s.current = function () { return items[s.index]; };

        function restart() {
            clearInterval(s.timer);
            if (s.playing && !s.dead) {
                s.timer = setInterval(function () { s.show(s.index + 1); }, AUTOPLAY_MS);
            }
        }

        s.show = function (i) {
            if (s.dead || !n()) return;
            s.index = ((i % n()) + n()) % n();
            var m = items[s.index];
            var token = ++s.token;

            content.css('opacity', 0);
            bg.css('opacity', 0);

            var posterSrc = imgUrl(POSTER_SIZE, m.poster_path);
            var bgSrc = m.backdrop_path ? imgUrl(BACKDROP_SIZE, m.backdrop_path) : posterSrc;
            var blur = !m.backdrop_path;

            var ready = 0;
            function apply() {
                if (token !== s.token || s.dead) return;
                if (++ready < 2) return;
                bg.css({
                    'background-image': 'url(' + bgSrc + ')',
                    'filter': blur ? 'blur(25px) brightness(.6)' : 'none',
                    'opacity': 1
                });
                content.html(contentHtml(m)).css('opacity', 1);

                // замінюємо текстову назву на логотип, коли він завантажиться
                loadLogo(m, function (url) {
                    if (!url || token !== s.token || s.dead) return;
                    var li = new Image();
                    li.onload = function () {
                        if (token !== s.token || s.dead) return;
                        content.find('.tps-title').addClass('tps-title-logo')
                            .html('<img class="tps-logo" src="' + url + '" />');
                        content.find('.tps-meta').text(metaText(m, true));
                    };
                    li.src = url;
                });
            }

            var a = new Image(); a.onload = a.onerror = apply; a.src = posterSrc;
            var b = new Image(); b.onload = b.onerror = apply; b.src = bgSrc;

            counter.text((s.index + 1) + ' / ' + n());
            preload(items[(s.index + 1) % n()]);
            loadLogo(items[(s.index + 1) % n()], function () {});
            preload(items[(s.index - 1 + n()) % n()]);
            restart();
        };

        s.flash = function (text) {
            hint.text(text).css('opacity', 1);
            clearTimeout(s.hintTimer);
            s.hintTimer = setTimeout(function () { hint.css('opacity', 0); }, 2500);
        };

        s.togglePlay = function () {
            s.playing = !s.playing;
            restart();
            s.flash(s.playing ? 'Автопоказ: увімкнено' : 'Пауза');
        };

        s.pause = function () { clearInterval(s.timer); };
        s.resume = function () { restart(); };

        s.destroy = function () {
            s.dead = true;
            s.token++;
            clearInterval(s.timer);
            clearTimeout(s.hintTimer);
        };

        // клік / тап по постеру — відкрити сторінку фільму
        root.on('click', '.tps-poster', function () {
            if (onOpen) onOpen(s.current());
        });

        return s;
    }

    function openFull(m) {
        if (!m) return;
        Lampa.Activity.push({
            url: '',
            component: 'full',
            id: m.id,
            method: m.media_type === 'tv' ? 'tv' : 'movie',
            card: m,
            source: 'tmdb'
        });
    }

    var HINT = '← → гортати · OK відкрити · ↑ пауза · Назад меню';

    function controls(name, getSlider, onBack, onEnter) {
        Lampa.Controller.add(name, {
            toggle: function () { Lampa.Controller.clear(); },
            left: function () { var s = getSlider(); if (s) s.show(s.index - 1); },
            right: function () { var s = getSlider(); if (s) s.show(s.index + 1); },
            up: function () { var s = getSlider(); if (s) s.togglePlay(); },
            down: function () { var s = getSlider(); if (s) s.show(s.index + 5); },
            enter: onEnter,
            back: onBack
        });
    }

    /* ---------- Повноекранний режим (з меню "Постери") ---------- */

    var overlay = { root: null, slider: null, prev: null };

    function closeOverlay(skipRestore) {
        if (overlay.slider) overlay.slider.destroy();
        if (overlay.root) overlay.root.remove();
        overlay.root = overlay.slider = null;
        if (!skipRestore) {
            var prev = overlay.prev || 'content';
            try { Lampa.Controller.toggle(prev); } catch (e) { Lampa.Controller.toggle('content'); }
        }
    }

    function openOverlay(period) {
        Lampa.Noty.show('Завантаження...');

        prepare(period, function (items) {
            if (!items.length) {
                Lampa.Noty.show('Не вдалося завантажити дані TMDB' + (lastError ? ' (' + lastError + ')' : '') + '. Спробуйте увімкнути проксі TMDB у налаштуваннях.');
                return;
            }

            try { overlay.prev = Lampa.Controller.enabled().name; } catch (e) { overlay.prev = 'content'; }

            overlay.root = $('<div class="tps-root"></div>');
            $('body').append(overlay.root);

            overlay.slider = createSlider(overlay.root, items, function (m) {
                closeOverlay(true);
                openFull(m);
            });

            controls('tmdb_posters',
                function () { return overlay.slider; },
                function () { closeOverlay(false); },
                function () {
                    var m = overlay.slider && overlay.slider.current();
                    closeOverlay(true);
                    openFull(m);
                }
            );
            Lampa.Controller.toggle('tmdb_posters');

            overlay.slider.show(0);
            overlay.slider.flash(HINT);
        });
    }

    /* ---------- Головна сторінка (компонент Lampa) ---------- */

    function HomeComponent(object) {
        var html = $('<div class="tps-root tps-inline"></div>');
        var slider = null;
        var self = this;

        this.create = function () {
            prepare(homePeriod(), function (items) {
                if (!items.length) {
                    Lampa.Noty.show('Не вдалося завантажити головну' + (lastError ? ' (' + lastError + ')' : '') + ', відкриваю стандартну');
                    try { self.activity.loader(false); } catch (e) {}
                    Lampa.Activity.replace({ url: '', title: 'Головна', component: 'main', source: 'tmdb', page: 1, tps_skip: true });
                    return;
                }

                slider = createSlider(html, items, openFull);
                slider.show(0);
                slider.flash(HINT);

                self.activity.loader(false);
                self.activity.toggle();
            });
        };

        this.start = function () {
            controls('tps_home',
                function () { return slider; },
                function () { Lampa.Controller.toggle('menu'); },
                function () { if (slider) openFull(slider.current()); }
            );
            Lampa.Controller.toggle('tps_home');
            if (slider) slider.resume();
        };

        this.pause = function () { if (slider) slider.pause(); };
        this.stop = function () { if (slider) slider.pause(); };
        this.render = function () { return html; };
        this.destroy = function () {
            if (slider) slider.destroy();
            html.remove();
        };
    }

    function isTmdbMain(object) {
        return !object || !object.source || object.source === 'tmdb';
    }

    function hookMainPage() {
        // 1) підміна самого компонента "main" (спрацьовує на будь-який спосіб відкриття головної)
        try {
            if (!Lampa.__tps_comp_hooked && Lampa.Component && Lampa.Component.get) {
                var origMain = Lampa.Component.get('main');
                if (origMain) {
                    Lampa.__tps_comp_hooked = true;
                    Lampa.Component.add('main', function (object) {
                        if (homeEnabled() && !(object && object.tps_skip) && isTmdbMain(object)) {
                            return new HomeComponent(object);
                        }
                        return new origMain(object);
                    });
                }
            }
        } catch (e) { console.log('TMDB posters: не вдалося підмінити main', e); }

        // 2) запасний варіант: перехоплення Activity.push
        if (Lampa.Activity.__tps_hooked) return;
        Lampa.Activity.__tps_hooked = true;

        var origPush = Lampa.Activity.push;
        Lampa.Activity.push = function (params) {
            try {
                if (params && params.component === 'main' && !params.tps_skip && homeEnabled() &&
                    (!params.source || params.source === 'tmdb')) {
                    params = $.extend({}, params, { component: 'tps_home', page: 1 });
                }
            } catch (e) {}
            return origPush.call(Lampa.Activity, params);
        };
    }

    /* ---------- Меню ---------- */

    function chooseSource() {
        Lampa.Select.show({
            title: 'TMDB тренди',
            items: [
                { title: 'Тренди сьогодні (повний екран)', action: 'day' },
                { title: 'Тренди цього тижня (повний екран)', action: 'week' },
                { title: 'Замінювати головну: ' + (homeEnabled() ? 'так' : 'ні'), action: 'toggle_home' },
                { title: 'Головна показує: ' + (homePeriod() === 'week' ? 'тренди тижня' : 'тренди сьогодні'), action: 'toggle_period' }
            ],
            onSelect: function (a) {
                if (a.action === 'day' || a.action === 'week') {
                    openOverlay(a.action);
                } else if (a.action === 'toggle_home') {
                    Lampa.Storage.set('tps_home', homeEnabled() ? 'false' : 'true');
                    Lampa.Noty.show('Головна: ' + (homeEnabled() ? 'слайд-шоу' : 'стандартна') + ' (набуде чинності при наступному відкритті)');
                    Lampa.Controller.toggle('menu');
                } else if (a.action === 'toggle_period') {
                    Lampa.Storage.set('tps_period', homePeriod() === 'week' ? 'day' : 'week');
                    Lampa.Noty.show('Головна показує: ' + (homePeriod() === 'week' ? 'тренди тижня' : 'тренди сьогодні'));
                    Lampa.Controller.toggle('menu');
                }
            },
            onBack: function () {
                Lampa.Controller.toggle('menu');
            }
        });
    }

    function addStyles() {
        if ($('#tps-style').length) return;
        $('head').append(
            '<style id="tps-style">' +
            '.tps-root{position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:#0b1d2a;overflow:hidden;color:#fff;}' +
            '.tps-root.tps-inline{z-index:1;}' +
            '.tps-bg{position:absolute;left:0;top:0;right:0;bottom:0;background-size:cover;background-position:center;' +
                'transform:scale(1.1);opacity:0;transition:opacity .5s ease;}' +
            '.tps-shade{position:absolute;left:0;top:0;right:0;bottom:0;' +
                'background:linear-gradient(90deg,rgba(8,22,34,.96) 0%,rgba(8,22,34,.85) 45%,rgba(8,22,34,.55) 100%);}' +
            '.tps-content{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;' +
                'padding:3em 5%;opacity:0;transition:opacity .4s ease;box-sizing:border-box;}' +
            '.tps-poster{flex:0 0 auto;height:100%;max-height:34em;aspect-ratio:2/3;border-radius:.8em;overflow:hidden;' +
                'box-shadow:0 .5em 2em rgba(0,0,0,.6);cursor:pointer;}' +
            '.tps-poster img{display:block;height:100%;width:auto;max-width:100%;}' +
            '.tps-info{flex:1 1 auto;min-width:0;margin-left:3em;}' +
            '.tps-title{font-size:2.6em;font-weight:700;line-height:1.15;}' +
            '.tps-year{font-weight:400;opacity:.7;}' +
            '.tps-logo{display:block;max-width:100%;max-height:7em;object-fit:contain;object-position:left center;' +
                'filter:drop-shadow(0 0 .4em rgba(0,0,0,.5));}' +
            '.tps-meta{margin-top:.5em;font-size:1.3em;opacity:.8;}' +
            '.tps-rate{display:flex;align-items:center;margin-top:1.2em;}' +
            '.tps-circle{width:3.2em;height:3.2em;border:.22em solid #21d07a;border-radius:50%;background:#081c22;' +
                'display:flex;align-items:center;justify-content:center;font-size:1.3em;font-weight:700;box-sizing:border-box;}' +
            '.tps-circle span{font-size:.55em;margin-top:-.4em;}' +
            '.tps-ratetext{margin-left:.8em;font-size:1.1em;font-weight:700;line-height:1.2;}' +
            '.tps-overview-title{margin-top:1.4em;font-size:1.5em;font-weight:700;}' +
            '.tps-overview{margin-top:.4em;font-size:1.3em;line-height:1.45;max-width:38em;opacity:.92;' +
                'display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden;}' +
            '.tps-counter{position:absolute;right:1.5em;bottom:1em;color:rgba(255,255,255,.55);font-size:1.2em;}' +
            '.tps-hint{position:absolute;left:50%;top:1.2em;transform:translateX(-50%);' +
                'background:rgba(0,0,0,.65);color:#fff;padding:.5em 1em;border-radius:.5em;' +
                'font-size:1.2em;opacity:0;transition:opacity .4s ease;white-space:nowrap;}' +
            '</style>'
        );
    }

    function addMenuButton() {
        if ($('.menu .tps-menu-item').length) return;

        var btn = $(
            '<li class="menu__item selector tps-menu-item">' +
                '<div class="menu__ico">' +
                    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                        '<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/>' +
                        '<path d="M3 16l5-5 4 4 3-3 6 6" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
                        '<circle cx="16" cy="9" r="1.5" fill="currentColor"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="menu__text">Постери</div>' +
            '</li>'
        );

        btn.on('hover:enter', chooseSource);
        $('.menu .menu__list').eq(0).append(btn);
    }

    function init() {
        addStyles();
        Lampa.Component.add('tps_home', HomeComponent);
        hookMainPage();
        addMenuButton();
    }

    // Перехоплення головної ставимо одразу (до готовності застосунку),
    // щоб підхопити і стартову сторінку
    try {
        if (window.Lampa && Lampa.Component && Lampa.Activity) {
            Lampa.Component.add('tps_home', HomeComponent);
            hookMainPage();
        }
    } catch (e) {}

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
