/*
 * Misto FM — радіо-плагін для Lampa (AzuraCast: stream.mistofm.com)
 * Кнопка на верхній панелі, перемикання станцій пультом.
 */
(function () {
    'use strict';

    if (window.misto_fm_plugin) return;
    window.misto_fm_plugin = true;

    var API_BASE = 'https://stream.mistofm.com';
    var DEFAULT_SLUG = 'misto_fm_deep';
    var POLL_MS = 15000;

    // запасний список, поки API не відповіло
    var stations = [
        { slug: 'misto_fm_deep', name: 'Deep' },
        { slug: 'misto_fm_juda', name: 'Juda' },
        { slug: 'misto_fm_beats', name: 'Beats' }
    ];
    var data = {}; // slug -> { title, artist, art, listenUrl }

    var audio = null;
    var state = { playing: false, loading: false, title: '', artist: '', art: '', listenUrl: '' };
    var listeners = [];
    var opened = 0;
    var pollTimer = null;
    var stopping = false;
    var starting = false;
    var apiWarned = false;

    function S(key, def) { return Lampa.Storage.get(key, def); }
    function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }
    function slug() { return trim(S('misto_slug', '')) || DEFAULT_SLUG; }

    function stationName(sl) {
        var st = stations.filter(function (s) { return s.slug === sl; })[0];
        return st ? st.name : sl;
    }

    // запасна обкладинка станції з сайту
    function seoCover(sl) {
        return 'https://mistofm.com/assets/img/seo/' + sl.replace(/^misto_fm_/, '') + '/1200x1200.jpg';
    }

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

    function fixUrl(u) {
        return (u || '').replace(/^http:\/\/stream\.mistofm\.com/, 'https://stream.mistofm.com');
    }

    /* ---------- API станцій (AzuraCast) ---------- */

    function apiUrl(path) {
        var url = API_BASE + path;
        var proxy = trim(S('misto_proxy', ''));
        if (!proxy) return url;
        if (proxy.indexOf('{url}') > -1) return proxy.replace('{url}', encodeURIComponent(url));
        return proxy + url;
    }

    function applyCurrent() {
        var d = data[slug()] || {};
        state.title = d.title || '';
        state.artist = d.artist || '';
        state.art = d.art || '';
        state.listenUrl = d.listenUrl || '';
    }

    function refreshNow() {
        new Lampa.Reguest().silent(apiUrl('/api/nowplaying'), function (j) {
            try {
                var arr = Object.prototype.toString.call(j) === '[object Array]' ? j : (j ? [j] : []);
                var list = [];

                arr.forEach(function (item) {
                    var st = item && item.station;
                    if (!st || !st.shortcode) return;

                    var url = st.listen_url;
                    if (!url && st.mounts && st.mounts.length) {
                        var def = st.mounts.filter(function (m) { return m.is_default; })[0] || st.mounts[0];
                        url = def && def.url;
                    }

                    var song = item.now_playing && item.now_playing.song;
                    data[st.shortcode] = {
                        title: song ? (song.title || song.text || '') : '',
                        artist: song ? (song.artist || '') : '',
                        art: song ? fixUrl(song.art || '') : '',
                        listenUrl: fixUrl(url || '')
                    };

                    list.push({
                        slug: st.shortcode,
                        name: (st.name || st.shortcode).replace(/^Misto FM\s*/i, '') || st.shortcode
                    });
                });

                if (list.length) {
                    var changed = JSON.stringify(list) !== JSON.stringify(stations);
                    stations = list;
                    applyCurrent();
                    notify();
                    if (changed) notify.stationsChanged && notify.stationsChanged();
                }
            } catch (e) {}
        }, function () {
            if (!apiWarned) {
                apiWarned = true;
                Lampa.Noty.show('Misto FM: API станцій недоступне напряму. Вкажіть проксі в Налаштування → Misto FM');
            }
            notify();
        });
    }

    function ensurePoll() {
        var need = opened > 0 || state.playing;
        if (need && !pollTimer) pollTimer = setInterval(refreshNow, POLL_MS);
        if (!need && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    /* ---------- Відтворення ---------- */

    function streamUrl() {
        return state.listenUrl ||
            trim(S('misto_stream', '')) ||
            (API_BASE + '/listen/' + slug() + '/radio.mp3');
    }

    function getAudio() {
        if (audio) return audio;
        audio = new Audio();
        audio.preload = 'none';
        audio.volume = 0.8;

        audio.addEventListener('playing', function () {
            starting = false; state.playing = true; state.loading = false; ensurePoll(); notify();
        });
        audio.addEventListener('pause', function () {
            if (starting) return; // це "хвіст" попередньої зупинки під час перемикання
            state.playing = false; state.loading = false; ensurePoll(); notify();
        });
        audio.addEventListener('waiting', function () {
            state.loading = true; notify();
        });
        audio.addEventListener('error', function () {
            if (stopping || !audio.getAttribute('src')) return;
            starting = false; state.playing = false; state.loading = false; ensurePoll(); notify();
            Lampa.Noty.show('Misto FM: потік не відтворюється (' + streamUrl().replace(/^https?:\/\//, '').slice(0, 60) + ')');
        });
        return audio;
    }

    function startAudio() {
        var a = getAudio();
        var url = streamUrl();
        stopping = false;
        starting = true;
        state.loading = true;
        notify();
        a.src = url + (url.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
        var p = a.play();
        if (p && p.catch) {
            p.catch(function () {
                if (stopping) return;
                starting = false; state.loading = false; notify();
                Lampa.Noty.show('Misto FM: не вдалося запустити потік');
            });
        }
    }

    function stopAudio() {
        if (!audio) return;
        stopping = true;
        starting = false;
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

    function setStation(newSlug) {
        if (newSlug === slug() && (state.playing || state.loading)) return;

        Lampa.Storage.set('misto_slug', newSlug);
        applyCurrent();

        if (audio) stopAudio();
        notify();
        refreshNow();
        startAudio();
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
            '.misto-radio__stations{display:flex;justify-content:center;flex-wrap:wrap;gap:.8em;margin-bottom:1.4em}' +
            '.misto-radio__chip{padding:.5em 1.2em;border-radius:2em;background:rgba(255,255,255,.1);font-size:1.1em}' +
            '.misto-radio__chip--active{background:rgba(255,255,255,.35);font-weight:600}' +
            '.misto-radio__art{width:16em;height:16em;object-fit:cover;border-radius:1.2em;background:rgba(255,255,255,.08);margin-bottom:1.2em}' +
            '.misto-radio__station{font-size:1em;opacity:.6;letter-spacing:.15em;text-transform:uppercase;margin-bottom:.6em}' +
            '.misto-radio__title{font-size:1.8em;font-weight:600;max-width:20em;margin:0 auto}' +
            '.misto-radio__artist{font-size:1.2em;opacity:.7;margin-top:.3em;min-height:1.4em}' +
            '.misto-radio__buttons{display:flex;justify-content:center;align-items:center;gap:1em;margin-top:1.4em}' +
            '.misto-radio__btn{padding:.8em 1.6em;border-radius:.8em;background:rgba(255,255,255,.1);font-size:1.2em}' +
            '.misto-radio__btn--main{min-width:9em}' +
            '.misto-radio__chip.focus,.misto-radio__btn.focus{background:#fff;color:#000}' +
            '.misto-head svg{width:1.7em;height:1.7em}' +
            '.misto-head{opacity:.75}' +
            '.misto-head.misto-head--on{opacity:1;color:#4cd964}' +
        '</style>').appendTo('head');
    }

    function RadioComponent(object) {
        var unsub;
        var lastFocus = false;
        var shownStations = '';

        var html = $(
            '<div class="misto-radio"><div>' +
                '<div class="misto-radio__stations"></div>' +
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

        function bindFocus(el) {
            el.on('hover:focus', function () { lastFocus = this; });
        }

        function renderStations() {
            var key = JSON.stringify(stations);
            if (key === shownStations) return false;
            shownStations = key;

            var box = html.find('.misto-radio__stations').empty();
            stations.forEach(function (st) {
                var chip = $('<div class="misto-radio__chip selector"></div>')
                    .text(st.name)
                    .attr('data-slug', st.slug);
                chip.on('hover:enter', function () { setStation(st.slug); });
                bindFocus(chip);
                box.append(chip);
            });
            lastFocus = false;
            return true;
        }

        function update() {
            var rebuilt = renderStations();
            var cur = slug();

            var art = state.art || seoCover(cur);
            var img = html.find('.misto-radio__art');
            if (img.attr('data-src') !== art) {
                img.attr('data-src', art).attr('src', art).show();
            }

            html.find('.misto-radio__station').text('Misto FM ' + stationName(cur));
            html.find('.misto-radio__title').text(state.title || (state.loading ? 'Завантаження…' : 'Misto FM'));
            html.find('.misto-radio__artist').text(state.artist || '');
            html.find('[data-act="toggle"]').text(
                state.loading ? '… Завантаження' : (state.playing ? '■ Стоп' : '▶ Грати')
            );
            html.find('.misto-radio__chip').each(function () {
                $(this).toggleClass('misto-radio__chip--active', $(this).attr('data-slug') === cur);
            });

            if (rebuilt) {
                try {
                    if (Lampa.Controller.enabled().name === 'misto_radio') Lampa.Controller.toggle('misto_radio');
                } catch (e) {}
            }
        }

        this.create = function () {
            addStyle();

            html.find('.misto-radio__art').on('error', function () { $(this).hide(); });

            html.find('.misto-radio__btn').on('hover:enter', function () {
                var act = $(this).data('act');
                if (act === 'toggle') toggleAudio();
                if (act === 'vdown') changeVolume(-0.1);
                if (act === 'vup') changeVolume(0.1);
            });
            bindFocus(html.find('.misto-radio__btn'));

            applyCurrent();
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
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
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

    /* ---------- Налаштування та кнопка на верхній панелі ---------- */

    var ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16v10H4zM8 9l8-5M8 14h4M16 14h.01M16 17h.01"/></svg>';

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
                    apiWarned = false;
                    Lampa.Noty.show(title + ': збережено');
                    try { Lampa.Controller.toggle('settings_component'); } catch (e) {}
                });
            }
        });
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({ component: 'misto', name: 'Misto FM', icon: ICON });

        addTextSetting(
            'misto_proxy',
            'Проксі для API',
            'Необов\'язково. Шаблон з {url}, потрібен, якщо назва треку й обкладинка не з\'являються (CORS). Аудіо йде напряму'
        );

        addTextSetting(
            'misto_stream',
            'Посилання на потік',
            'Необов\'язково. Запасний варіант, якщо потік не визначається автоматично'
        );
    }

    function openRadio() {
        try {
            var act = Lampa.Activity.active();
            if (act && act.component === 'misto_radio') return;
        } catch (e) {}
        Lampa.Activity.push({ url: '', title: 'Misto FM', component: 'misto_radio', page: 1 });
    }

    function addHeadButton(tries) {
        tries = tries || 0;
        var bar = $('.head .head__actions');

        if (!bar.length) {
            if (tries < 20) setTimeout(function () { addHeadButton(tries + 1); }, 500);
            return;
        }
        if ($('.misto-head').length) return;

        var btn = $('<div class="head__action selector misto-head">' + ICON + '</div>');
        btn.on('hover:enter', openRadio);
        bar.prepend(btn);

        btn.toggleClass('misto-head--on', state.playing);
    }

    function init() {
        addStyle();
        Lampa.Component.add('misto_radio', RadioComponent);
        addSettings();
        addHeadButton();

        subscribe(function () {
            $('.misto-head').toggleClass('misto-head--on', !!state.playing);
        });

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
