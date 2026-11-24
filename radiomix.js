/*
 * RadioMIX для Lampa
 * Усі станції з https://radiomix.dance (Icecast: stream.radiomix.dance)
 * Додає пункт «RadioMIX» у бокове меню. OK на станції — грати / зупинити.
 */
(function () {
    'use strict';

    if (window.radiomix_plugin) return;
    window.radiomix_plugin = true;

    var STREAM = 'https://stream.radiomix.dance/';
    var LOGO = 'https://radiomix.dance/images/';

    var STATIONS = [
        { id: 'radiomix',  name: 'RadioMIX',   desc: 'Головний ефір' },
        { id: 'recover',   name: 'ReCover',    desc: 'Кавери на світові хіти' },
        { id: 'reretro',   name: 'ReRetro',    desc: 'Ретро-ремікси' },
        { id: 'rechill',   name: 'ReChill',    desc: 'Чилаут' },
        { id: 'remix',     name: 'ReMix',      desc: 'Ремікси' },
        { id: 'reradio',   name: 'ReRadio',    desc: 'Dance-ремікси' },
        { id: 'resympho',  name: 'ReSympho',   desc: 'Симфонічні кавери' },
        { id: 'rerusskoe', name: 'ReРусское',  desc: 'Російські ремікси' },
        { id: 'refitness', name: 'ReFitness',  desc: 'Музика для фітнесу' }
    ];

    var audio = null;      // єдиний аудіо-об'єкт, грає і поза межами екрана плагіна
    var current = null;    // id станції, що грає
    var titles = {};       // id -> поточний трек
    var opened = 0;        // скільки екранів радіо відкрито
    var poll = null;

    /* ---------- метадані (що зараз грає) ---------- */

    function fetchMeta() {
        if (!window.fetch) return;
        fetch(STREAM + 'status-json.xsl', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var src = j && j.icestats && j.icestats.source;
                if (!src) return;
                if (!Array.isArray(src)) src = [src];
                src.forEach(function (s) {
                    var mount = (s.listenurl || '').split('?')[0].split('/').pop();
                    if (mount) titles[mount] = s.title || '';
                });
                updateUI();
            })
            .catch(function () { /* CORS або мережа — просто без назв треків */ });
    }

    function ensurePoll() {
        if (poll) return;
        fetchMeta();
        poll = setInterval(fetchMeta, 15000);
    }

    function releasePoll() {
        if (!current && !opened && poll) {
            clearInterval(poll);
            poll = null;
        }
    }

    /* ---------- відтворення ---------- */

    function stop() {
        if (audio) {
            try { audio.pause(); } catch (e) {}
            audio.removeAttribute('src');
            try { audio.load(); } catch (e) {}
            audio = null;
        }
        current = null;
        updateUI();
        releasePoll();
    }

    function play(st) {
        if (current === st.id) return stop();

        if (audio) {
            try { audio.pause(); } catch (e) {}
            audio = null;
        }

        var a = new Audio();
        audio = a;
        current = st.id;
        a.preload = 'none';
        a.src = STREAM + st.id;

        a.addEventListener('error', function () {
            if (audio !== a) return;
            Lampa.Noty.show('Не вдалося відтворити ' + st.name);
            stop();
        });

        var p = a.play();
        if (p && p.catch) {
            p.catch(function () {
                if (audio !== a) return;
                Lampa.Noty.show('Не вдалося запустити ' + st.name);
                stop();
            });
        }

        ensurePoll();
        updateUI();
    }

    function updateUI() {
        $('.radiomix__card').each(function () {
            var el = $(this);
            var id = el.data('id');
            el.toggleClass('radiomix__card--playing', id === current);
            el.find('.radiomix__track').text(titles[id] || '');
        });

        var st = null;
        STATIONS.forEach(function (s) { if (s.id === current) st = s; });

        $('.radiomix__now').text(
            st ? '▶ ' + st.name + (titles[st.id] ? ' — ' + titles[st.id] : '')
               : 'Обери станцію і натисни OK'
        );
    }

    /* ---------- екран плагіна ---------- */

    function RadioMix() {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div class="radiomix"></div>');
        var now = $('<div class="radiomix__now"></div>');
        var grid = $('<div class="radiomix__grid"></div>');
        var last;

        this.create = function () {
            opened++;

            STATIONS.forEach(function (st) {
                var card = $(
                    '<div class="radiomix__card selector">' +
                        '<div class="radiomix__logo"><img src="' + LOGO + st.id + '.svg" alt=""></div>' +
                        '<div class="radiomix__name">' + st.name + '</div>' +
                        '<div class="radiomix__desc">' + st.desc + '</div>' +
                        '<div class="radiomix__track"></div>' +
                    '</div>'
                );

                card.data('id', st.id);

                card.find('img').on('error', function () { $(this).hide(); });

                card.on('hover:focus', function (e) {
                    last = e.target;
                    scroll.update(card, true);
                });

                card.on('hover:enter', function () { play(st); });

                grid.append(card);
            });

            scroll.render().addClass('layer--wheight');
            scroll.append(now);
            scroll.append(grid);
            html.append(scroll.render());

            updateUI();
            ensurePoll();

            return this.render();
        };

        this.start = function () {
            Lampa.Controller.add('radiomix', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () { Navigator.move('right'); },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
                back: function () { Lampa.Activity.backward(); }
            });

            Lampa.Controller.toggle('radiomix');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };

        this.destroy = function () {
            opened = Math.max(0, opened - 1);
            releasePoll();
            scroll.destroy();
            html.remove();
        };
    }

    /* ---------- підключення до Lampa ---------- */

    function addStyles() {
        if ($('#radiomix-style').length) return;

        $('head').append(
            '<style id="radiomix-style">' +
            '.radiomix__now{padding:1.2em 1.5em .4em;font-size:1.3em;opacity:.85}' +
            '.radiomix__grid{display:flex;flex-wrap:wrap;padding:.5em 1em 2em}' +
            '.radiomix__card{width:calc(33.33% - 1em);margin:.5em;padding:1.2em;border-radius:.8em;' +
                'background:rgba(255,255,255,.07);box-sizing:border-box;border:.2em solid transparent}' +
            '.radiomix__card.focus{background:rgba(255,255,255,.18);border-color:#fff}' +
            '.radiomix__card--playing{border-color:#4cd964}' +
            '.radiomix__card--playing.focus{border-color:#fff}' +
            '.radiomix__logo{height:4.5em;display:flex;align-items:center;justify-content:center;' +
                'background:#1b1b1b;border-radius:.5em;margin-bottom:.8em;padding:.5em;box-sizing:border-box}' +
            '.radiomix__logo img{max-width:100%;max-height:100%}' +
            '.radiomix__name{font-size:1.4em;font-weight:600}' +
            '.radiomix__desc{opacity:.6;margin-top:.2em}' +
            '.radiomix__track{margin-top:.5em;font-size:.95em;color:#4cd964;min-height:1.2em;' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '@media (max-width:900px){.radiomix__card{width:calc(50% - 1em)}}' +
            '</style>'
        );
    }

    function addMenu() {
        if ($('.menu [data-action="radiomix"]').length) return;

        var btn = $(
            '<li class="menu__item selector" data-action="radiomix">' +
                '<div class="menu__ico">' +
                    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ' +
                    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<rect x="3" y="8" width="18" height="12" rx="2"/>' +
                    '<path d="M7 8l10-5"/><circle cx="9" cy="14" r="2.5"/>' +
                    '<path d="M15 12h3M15 16h3"/></svg>' +
                '</div>' +
                '<div class="menu__text">RadioMIX</div>' +
            '</li>'
        );

        btn.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: 'RadioMIX',
                component: 'radiomix',
                page: 1
            });
        });

        $('.menu .menu__list').eq(0).append(btn);
    }

    function init() {
        addStyles();
        Lampa.Component.add('radiomix', RadioMix);
        addMenu();

        // коли запускається відео в Lampa — радіо вимикаємо
        try {
            Lampa.Player.listener.follow('start', function () { if (current) stop(); });
        } catch (e) {}
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
