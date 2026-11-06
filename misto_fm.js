/*
 * Misto FM — радіо-плагін для Lampa (AzuraCast: stream.mistofm.com)
 * Налаштування: Налаштування → Misto FM
 */
(function () {
    'use strict';

    if (window.misto_fm_plugin) return;
    window.misto_fm_plugin = true;

    var API_BASE = 'https://stream.mistofm.com';
    var DEFAULT_SLUG = 'misto_fm_deep';
    var DEFAULT_COVER = 'https://mistofm.com/assets/img/seo/deep/1200x1200.jpg';
    var POLL_MS = 15000;

    var audio = null;
    var state = { playing: false, loading: false, title: '', artist: '', art: '', listenUrl: '' };
    var listeners = [];
    var opened = 0;
    var pollTimer = null;
    var stopping = false;

    function S(key, def) { return Lampa.Storage.get(key, def); }
    function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }
    function slug() { return trim(S('misto_slug', '')) || DEFAULT_SLUG; }

    function notify() {
        listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
    }

    function subscribe(fn) {
        listeners.push(fn);
        return function () {
            var i = listeners.indexOf(fn);
            if (i > -1) listeners.splice(i, 1);
        };
    }

    /* ---------- Дані зі станції (AzuraCast API) ---------- */

    function fixUrl(u) {
        return (u || '').replace(/^http:\/\/stream\.mistofm\.com/, 'https://stream.mistofm.com');
    }

    function refreshNow() {
        new Lampa.Reguest().silent(API_BASE + '/api/nowplaying/' + slug(), function (j) {
            try {
                var song = j && j.now_playing && j.now_playing.song;
                if (song) {
                    state.title = song.title || song.text || '';
                    state.artist = song.artist || '';
                    state.art = fixUrl(song.art || '');
                }
                var st = j && j.station;
                if (st) {
                    var url = st.listen_url;
                    if (!url && st.mounts && st.mounts.length) {
                        var def = st.mounts.filter(function (m) { return m.is_default; })[0] || st.mounts[0];
                        url = def && def.url;
                    }
                    if (url) state.listenUrl = fixUrl(url);
                }
            } catch (e) {}
            notify();
        }, function () { notify(); });
    }

    function ensurePoll() {
        var need = opened > 0 || state.playing;
        if (need && !pollTimer) pollTimer = setInterval(refreshNow, POLL_MS);
        if (!need && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    /* ---------- Відтворення ---------- */

    function streamUrl() {
        return trim(S('misto_stream', '')) ||
            state.listenUrl ||
            (API_BASE + '/listen/' + slug() + '/radio.mp3');
    }

    function getAudio() {
        if (audio) return audio;
        audio = new Audio();
        audio.preload = 'none';
        audio.volume = 0.8;

        audio.addEventListener('playing', function () {
            state.playing = true; state.loading = false; ensurePoll(); notify();
        });
        audio.addEventListener('pause', function () {
            state.playing = false; state.loading = false; ensurePoll(); notify();
        });
        audio.addEventListener('waiting', function () {
            state.loading = true; notify();
        });
        audio.addEventListener('error', function () {
            if (stopping) return;
            state.playing = false; state.loading = false; ensurePoll(); notify();
            Lampa.Noty.show('Misto FM: не вдалося відтворити потік');
        });
        return audio;
    }

    function startAudio() {
        var a = getAudio();
        var url = streamUrl();
        stopping = false;
        state.loading = true;
        notify();
        // додаємо мітку часу, щоб отримати "живий" потік, а не кеш
        a.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
        var p = a.play();
        if (p && p.catch) {
            p.catch(function () {
                if (stopping) return;
                state.loading = false; notify();
                Lampa.Noty.show('Misto FM: не вдалося запустити потік');
            });
        }
    }

    function stopAudio() {
        if (!audio) return;
        stopping = true;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        state.playing = false;
        state.loading = false;
        ensurePoll();
        notify();
    }

    function toggleAudio() {
        if (state.playing || state.loading) stopAudio();
        else startAudio();
    }

    function changeVolume(delta) {
        var a = getAudio();
        a.volume = Math.max(0, Math.min(1, Math.round((a.volume + delta) * 10) / 10));
        Lampa.Noty.show('Гучність: ' + Math.round(a.volume * 100) + '%');
    }

    /* ---------- Сторінка ---------- */

    function addStyle() {
        if ($('#misto-radio-style').length) return;
        $('<style id="misto-radio-style">' +
            '.misto-radio{display:flex;align-items:center;justify-content:center;height:100%;padding:2em;text-align:center}' +
            '.misto-radio__art{width:18em;height:18em;object-fit:cover;border-radius:1.2em;background:rgba(255,255,255,.08);margin-bottom:1.2em}' +
            '.misto-radio__station{font-size:1em;opacity:.6;letter-spacing:.15em;text-transform:uppercase;margin-bottom:.6em}' +
            '.misto-radio__title{font-size:1.8em;font-weight:600;max-width:20em;margin:0 auto}' +
            '.misto-radio__artist{font-size:1.2em;opacity:.7;margin-top:.3em;min-height:1.4em}' +
            '.misto-radio__buttons{display:flex;justify-content:center;align-items:center;gap:1em;margin-top:1.6em}' +
            '.misto-radio__btn{padding:.8em 1.6em;border-radius:.8em;background:rgba(255,255,255,.1);font-size:1.2em}' +
            '.misto-radio__btn--main{min-width:9em}' +
            '.misto-radio__btn.focus{background:#fff;color:#000}' +
        '</style>').appendTo('head');
    }

    function RadioComponent(object) {
        var unsub;
        var lastFocus = false;

        var html = $(
            '<div class="misto-radio"><div>' +
                '<img class="misto-radio__art" src="">' +
                '<div class="misto-radio__station">Misto FM</div>' +
                '<div class="misto-radio__title"></div>' +
                '<div class="misto-radio__artist"></div>' +
                '<div class="misto-radio__buttons">' +
                    '<div class="misto-radio__btn selector" data-act="vdown">−</div>' +
                    '<div class="misto-radio__btn misto-radio__btn--main selector" data-act="toggle">▶ Грати</div>' +
                    '<div class="misto-radio__btn selector" data-act="vup">+</div>' +
                '</div>' +
            '</div></div>'
        );

        function update() {
            var art = state.art || (slug() === DEFAULT_SLUG ? DEFAULT_COVER : '');
            var img = html.find('.misto-radio__art');
            if (art) img.attr('src', art).show(); else img.hide();

            html.find('.misto-radio__station').text(slug() === DEFAULT_SLUG ? 'Misto FM Deep' : 'Misto FM');
            html.find('.misto-radio__title').text(state.title || (state.loading ? 'Завантаження…' : 'Misto FM'));
            html.find('.misto-radio__artist').text(state.artist || '');
            html.find('[data-act="toggle"]').text(
                state.loading ? '… Завантаження' : (state.playing ? '■ Стоп' : '▶ Грати')
            );
        }

        this.create = function () {
            addStyle();

            html.find('.selector').on('hover:enter', function () {
                var act = $(this).data('act');
                if (act === 'toggle') toggleAudio();
                if (act === 'vdown') changeVolume(-0.1);
                if (act === 'vup') changeVolume(0.1);
            }).on('hover:focus', function () {
                lastFocus = this;
            });

            unsub = subscribe(update);
            opened++;
            ensurePoll();
            refreshNow();
            update();

            this.activity.loader(false);
            this.activity.toggle();
        };

        this.start = function () {
            Lampa.Controller.add('misto_radio', {
                toggle: function () {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(lastFocus || html.find('[data-act="toggle"]')[0], html);
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () { Navigator.move('right'); },
                up: function () { Lampa.Controller.toggle('head'); },
                down: function () { Navigator.move('down'); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('misto_radio');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };

        this.destroy = function () {
            if (unsub) unsub();
            opened = Math.max(0, opened - 1);
            ensurePoll();
            html.remove();
        };
    }

    /* ---------- Налаштування та меню ---------- */

    function addTextSetting(storageKey, title, description) {
        Lampa.SettingsApi.addParam({
            component: 'misto',
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
                    Lampa.Noty.show(title + ': збережено');
                    try { Lampa.Controller.toggle('settings_component'); } catch (e) {}
                });
            }
        });
    }

    var ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16v10H4zM8 9l8-5M8 14h4M16 14h.01M16 17h.01"/></svg>';

    function addSettings() {
        Lampa.SettingsApi.addComponent({ component: 'misto', name: 'Misto FM', icon: ICON });

        addTextSetting(
            'misto_slug',
            'Станція (slug)',
            'Необов\'язково. За замовчуванням: ' + DEFAULT_SLUG
        );

        addTextSetting(
            'misto_stream',
            'Посилання на потік',
            'Необов\'язково. Вкажіть, якщо автоматичне визначення потоку не працює'
        );
    }

    function addMenu() {
        var btn = $(
            '<li class="menu__item selector">' +
                '<div class="menu__ico">' + ICON + '</div>' +
                '<div class="menu__text">Misto FM</div>' +
            '</li>'
        );

        btn.on('hover:enter', function () {
            Lampa.Activity.push({ url: '', title: 'Misto FM', component: 'misto_radio', page: 1 });
        });

        $('.menu .menu__list').eq(0).append(btn);
    }

    function init() {
        Lampa.Component.add('misto_radio', RadioComponent);
        addSettings();
        addMenu();

        // коли запускається відео в Lampa, радіо ставимо на паузу
        try {
            Lampa.Player.listener.follow('start', function () {
                if (state.playing || state.loading) stopAudio();
            });
        } catch (e) {}
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
