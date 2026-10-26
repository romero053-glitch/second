(function () {
    'use strict';

    if (window.plugin_tmdb_posters_slideshow) return;
    window.plugin_tmdb_posters_slideshow = true;

    var TMDB_API_KEY = '2556f3c34d07b68f8eb2746f95d200cd'; // https://www.themoviedb.org/settings/api
    var PAGES = 3;            // скільки сторінок TMDB тягнути (по 20 позицій)
    var AUTOPLAY_MS = 10000;  // інтервал автоперемикання (OK — пауза/старт)
    var POSTER_SIZE = 'w780'; // w500 / w780 / original
    var BACKDROP_SIZE = 'w1280';

    var state = {
        items: [],
        index: 0,
        timer: null,
        playing: true,
        hintTimer: null,
        prevController: null,
        root: null,
        bg: null,
        content: null,
        counter: null,
        hint: null,
        token: 0
    };

    var genres = {};
    var lastError = '';

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

    function load(period, done) {
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

    function buildUI() {
        var root = $(
            '<div class="tps-root">' +
                '<div class="tps-bg"></div>' +
                '<div class="tps-shade"></div>' +
                '<div class="tps-content"></div>' +
                '<div class="tps-counter"></div>' +
                '<div class="tps-hint"></div>' +
            '</div>'
        );
        $('body').append(root);
        state.root = root;
        state.bg = root.find('.tps-bg');
        state.content = root.find('.tps-content');
        state.counter = root.find('.tps-counter');
        state.hint = root.find('.tps-hint');
    }

    function preload(i) {
        var n = state.items.length;
        var m = state.items[(i + n) % n];
        if (m) {
            var im = new Image(); im.src = imgUrl(POSTER_SIZE, m.poster_path);
            if (m.backdrop_path) { var bi = new Image(); bi.src = imgUrl(BACKDROP_SIZE, m.backdrop_path); }
        }
    }

    function show(i) {
        var n = state.items.length;
        if (!n) return;
        state.index = (i + n) % n;
        var m = state.items[state.index];
        var token = ++state.token;

        state.content.css('opacity', 0);
        state.bg.css('opacity', 0);

        var posterSrc = imgUrl(POSTER_SIZE, m.poster_path);
        var bgSrc = m.backdrop_path ? imgUrl(BACKDROP_SIZE, m.backdrop_path) : posterSrc;
        var blur = !m.backdrop_path;

        var ready = 0;
        function apply() {
            if (token !== state.token || !state.root) return;
            if (++ready < 2) return;
            state.bg.css({
                'background-image': 'url(' + bgSrc + ')',
                'filter': blur ? 'blur(25px) brightness(.6)' : 'none',
                'opacity': 1
            });
            state.content.html(contentHtml(m)).css('opacity', 1);
        }

        var a = new Image(); a.onload = a.onerror = apply; a.src = posterSrc;
        var b = new Image(); b.onload = b.onerror = apply; b.src = bgSrc;

        state.counter.text((state.index + 1) + ' / ' + n);
        preload(state.index + 1);
        preload(state.index - 1);
        restartTimer();
    }

    function flashHint(text) {
        state.hint.text(text).css('opacity', 1);
        clearTimeout(state.hintTimer);
        state.hintTimer = setTimeout(function () {
            if (state.hint) state.hint.css('opacity', 0);
        }, 2000);
    }

    function restartTimer() {
        clearInterval(state.timer);
        if (state.playing) {
            state.timer = setInterval(function () { show(state.index + 1); }, AUTOPLAY_MS);
        }
    }

    function close() {
        clearInterval(state.timer);
        clearTimeout(state.hintTimer);
        state.token++;
        if (state.root) state.root.remove();
        state.root = state.bg = state.content = state.counter = state.hint = null;
        var prev = state.prevController || 'content';
        try { Lampa.Controller.toggle(prev); } catch (e) { Lampa.Controller.toggle('content'); }
    }

    function open(period) {
        lastError = '';
        Lampa.Noty.show('Завантаження...');

        var haveGenres = Object.keys(genres).length > 0;
        function go() {
            load(period, function (items) {
                if (!items.length) {
                    Lampa.Noty.show('Не вдалося завантажити дані TMDB' + (lastError ? ' (' + lastError + ')' : '') + '. Спробуйте увімкнути проксі TMDB у налаштуваннях.');
                    return;
                }

                state.items = items;
                state.index = 0;
                state.playing = true;

                try { state.prevController = Lampa.Controller.enabled().name; } catch (e) { state.prevController = 'content'; }

                buildUI();

                Lampa.Controller.add('tmdb_posters', {
                    toggle: function () {
                        Lampa.Controller.clear();
                    },
                    left: function () { show(state.index - 1); },
                    right: function () { show(state.index + 1); },
                    up: function () { show(state.index - 5); },
                    down: function () { show(state.index + 5); },
                    enter: function () {
                        state.playing = !state.playing;
                        restartTimer();
                        flashHint(state.playing ? 'Автопоказ: увімкнено' : 'Пауза');
                    },
                    back: close
                });
                Lampa.Controller.toggle('tmdb_posters');

                show(0);
                flashHint('← → гортати · ОК пауза · Назад вихід');
            });
        }

        if (haveGenres) go(); else loadGenres(go);
    }

    function chooseSource() {
        Lampa.Select.show({
            title: 'TMDB тренди',
            items: [
                { title: 'Тренди сьогодні', period: 'day' },
                { title: 'Тренди цього тижня', period: 'week' }
            ],
            onSelect: function (a) {
                open(a.period);
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
            '.tps-bg{position:absolute;left:0;top:0;right:0;bottom:0;background-size:cover;background-position:center;' +
                'transform:scale(1.1);opacity:0;transition:opacity .5s ease;}' +
            '.tps-shade{position:absolute;left:0;top:0;right:0;bottom:0;' +
                'background:linear-gradient(90deg,rgba(8,22,34,.96) 0%,rgba(8,22,34,.85) 45%,rgba(8,22,34,.55) 100%);}' +
            '.tps-content{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;' +
                'padding:3em 5%;opacity:0;transition:opacity .4s ease;box-sizing:border-box;}' +
            '.tps-poster{flex:0 0 auto;height:100%;max-height:34em;aspect-ratio:2/3;border-radius:.8em;overflow:hidden;' +
                'box-shadow:0 .5em 2em rgba(0,0,0,.6);}' +
            '.tps-poster img{display:block;height:100%;width:auto;max-width:100%;}' +
            '.tps-info{flex:1 1 auto;min-width:0;margin-left:3em;}' +
            '.tps-title{font-size:2.6em;font-weight:700;line-height:1.15;}' +
            '.tps-year{font-weight:400;opacity:.7;}' +
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
                'font-size:1.2em;opacity:0;transition:opacity .4s ease;}' +
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
        addMenuButton();
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
