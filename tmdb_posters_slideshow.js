(function () {
    'use strict';

    if (window.plugin_tmdb_posters_slideshow) return;
    window.plugin_tmdb_posters_slideshow = true;

    var TMDB_API_KEY = '2556f3c34d07b68f8eb2746f95d200cd'; // https://www.themoviedb.org/settings/api
    var PAGES = 3;            // скільки сторінок TMDB тягнути (по 20 постерів)
    var AUTOPLAY_MS = 8000;   // інтервал автоперемикання (Enter — пауза/старт)
    var IMG_SIZE = 'w780';    // w500 / w780 / original

    var state = {
        items: [],
        index: 0,
        timer: null,
        playing: true,
        hintTimer: null,
        prevController: null,
        root: null,
        img: null,
        counter: null,
        hint: null,
        source: 'day'
    };

    function lang() {
        return Lampa.Storage.get('tmdb_lang', Lampa.Storage.get('language', 'uk'));
    }

    var lastError = '';

    function imgUrl(path) {
        // Lampa.TMDB.image враховує проксі TMDB з налаштувань Lampa
        try {
            return Lampa.TMDB.image('t/p/' + IMG_SIZE + path);
        } catch (e) {
            return 'https://image.tmdb.org/t/p/' + IMG_SIZE + path;
        }
    }

    function fetchPage(period, page, cb) {
        var url = Lampa.TMDB.api('trending/all/' + period + '?language=' + lang() + '&page=' + page);
        if (url.indexOf('api_key=') === -1) {
            var key = TMDB_API_KEY;
            if (!key) { try { key = Lampa.TMDB.key(); } catch (e) {} }
            url += '&api_key=' + key;
        }
        var req = new Lampa.Reguest();
        req.silent(url, function (json) {
            cb(json && json.results ? json.results : []);
        }, function (err, text) {
            try {
                lastError = (err && (err.status || err.statusText)) ? (err.status + ' ' + (err.statusText || '')) : (text || 'мережева помилка');
            } catch (e) { lastError = 'мережева помилка'; }
            console.log('TMDB posters: помилка запиту', url.replace(/api_key=[^&]+/, 'api_key=***'), err, text);
            cb([]);
        });
    }

    function load(period, done) {
        var left = PAGES, all = [];
        for (var p = 1; p <= PAGES; p++) {
            (function (page) {
                fetchPage(period, page, function (res) {
                    all[page - 1] = res;
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

    function buildUI() {
        var root = $(
            '<div class="tps-root">' +
                '<img class="tps-img" />' +
                '<div class="tps-counter"></div>' +
                '<div class="tps-hint"></div>' +
            '</div>'
        );
        $('body').append(root);
        state.root = root;
        state.img = root.find('.tps-img');
        state.counter = root.find('.tps-counter');
        state.hint = root.find('.tps-hint');
    }

    function preload(i) {
        var m = state.items[(i + state.items.length) % state.items.length];
        if (m) { var im = new Image(); im.src = imgUrl(m.poster_path); }
    }

    function show(i) {
        var n = state.items.length;
        if (!n) return;
        state.index = (i + n) % n;
        var m = state.items[state.index];

        state.img.css('opacity', 0);
        var src = imgUrl(m.poster_path);
        var tmp = new Image();
        tmp.onload = function () {
            state.img.attr('src', src).css('opacity', 1);
        };
        tmp.onerror = function () {
            state.img.attr('src', src).css('opacity', 1);
        };
        tmp.src = src;

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
        if (state.root) state.root.remove();
        state.root = state.img = state.counter = state.hint = null;
        var prev = state.prevController || 'content';
        try { Lampa.Controller.toggle(prev); } catch (e) { Lampa.Controller.toggle('content'); }
    }

    function open(period) {
        lastError = '';
        Lampa.Noty.show('Завантаження постерів...');

        load(period, function (items) {
            if (!items.length) {
                Lampa.Noty.show('Не вдалося завантажити постери TMDB' + (lastError ? ' (' + lastError + ')' : '') + '. Спробуйте увімкнути проксі TMDB у налаштуваннях.');
                return;
            }

            state.items = items;
            state.index = 0;
            state.playing = true;
            state.source = period;

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

    function chooseSource() {
        Lampa.Select.show({
            title: 'TMDB постери',
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
            '.tps-root{position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:#000;}' +
            '.tps-img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;' +
                'opacity:0;transition:opacity .4s ease;}' +
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
