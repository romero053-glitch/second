(function () {
    'use strict';

    if (window.uefir_channels_plugin) return;
    window.uefir_channels_plugin = true;

    var API = 'https://uefir.com/api/live-channels';
    var RESYNC_INTERVAL = 25000; // re-check the live program every 25s
    var DRIFT_TOLERANCE = 4;     // reseek if off by more than this many seconds

    var TXT = {
        uk: { menu: 'UEFIR — наживо', loading: 'Завантаження каналів…', fail: 'Не вдалося завантажити канали',
            switch: 'Канали', next: 'Далі: ', live_fail: 'Не вдалося завантажити трансляцію' },
        ru: { menu: 'UEFIR — в эфире', loading: 'Загрузка каналов…', fail: 'Не удалось загрузить каналы',
            switch: 'Каналы', next: 'Далее: ', live_fail: 'Не удалось загрузить трансляцию' },
        en: { menu: 'UEFIR — live', loading: 'Loading channels…', fail: 'Could not load channels',
            switch: 'Channels', next: 'Next: ', live_fail: 'Could not load the stream' }
    };

    function lang() {
        var l = 'uk';
        try { l = Lampa.Storage.get('language', 'uk') || 'uk'; } catch (e) {}
        if (l === 'uk') return 'uk';
        if (l === 'ru' || l === 'be') return 'ru';
        return 'en';
    }

    function t(key) { return TXT[lang()][key]; }

    function noty(text) {
        try { Lampa.Noty.show(text); } catch (e) {}
    }

    // ---------- API ----------

    function fetchChannels(ids, onDone, onFail) {
        var url = API;
        if (ids && ids.length) {
            url += '?' + ids.map(function (id) { return 'ids[]=' + encodeURIComponent(id); }).join('&');
        }

        var net = new Lampa.Reguest();
        net.timeout(15000);
        net.silent(url, function (json) {
            if (!json || !json.channels) { if (onFail) onFail(); return; }
            onDone(json);
        }, function () { if (onFail) onFail(); });
    }

    // ---------- channel picker ----------

    function openChannelList() {
        noty(t('loading'));

        fetchChannels(null, function (data) {
            var channels = data.channels.slice().sort(function (a, b) {
                return (b.popularity || 0) - (a.popularity || 0);
            });

            if (!channels.length) { noty(t('fail')); return; }

            Lampa.Select.show({
                title: t('menu'),
                items: channels.map(function (c) {
                    return {
                        title: c.channelName,
                        subtitle: c.program ? c.program.title : '',
                        channel: c
                    };
                }),
                onSelect: function (a) { openLive(a.channel); },
                onBack: function () {}
            });
        }, function () { noty(t('fail')); });
    }

    // ---------- live player overlay ----------

    var state = null; // { root, player, channel, program, fetched_at, resync_timer, hide_timer, prev_controller, ready }

    function ytApiReady(cb) {
        if (window.YT && window.YT.Player) return cb();

        window.__uefir_yt_cbs = window.__uefir_yt_cbs || [];
        window.__uefir_yt_cbs.push(cb);

        if (window.__uefir_yt_loading) return;
        window.__uefir_yt_loading = true;

        var prevReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function () {
            if (typeof prevReady === 'function') { try { prevReady(); } catch (e) {} }
            var list = window.__uefir_yt_cbs || [];
            window.__uefir_yt_cbs = [];
            list.forEach(function (fn) { try { fn(); } catch (e) {} });
        };

        var s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
    }

    function targetOffset() {
        if (!state || !state.program) return 0;
        var elapsed = (Date.now() - state.fetched_at) / 1000;
        var offset = state.program.offsetSeconds + elapsed;
        var dur = (Date.parse(state.program.endsAt) - Date.parse(state.program.startsAt)) / 1000;
        if (dur > 0) offset = Math.min(offset, dur - 1);
        return Math.max(0, offset);
    }

    function updateInfo() {
        if (!state || !state.root) return;
        state.root.find('.uefir-live__title').text(state.channel.channelName);
        state.root.find('.uefir-live__program').text(state.program ? state.program.title : '');
        state.root.find('.uefir-live__next').text(state.next_program ? t('next') + state.next_program.title : '');
    }

    function applyProgram(data, keepPlayer) {
        var ch = data.channels[0];
        if (!ch) return;

        state.channel = ch;
        state.next_program = ch.nextProgram;
        state.fetched_at = Date.now();

        var changed = !state.program || state.program.videoId !== (ch.program && ch.program.videoId);
        state.program = ch.program;

        updateInfo();

        if (!state.player || !state.ready) return;

        if (changed && ch.program) {
            state.player.loadVideoById(ch.program.videoId, targetOffset());
        } else if (keepPlayer && ch.program) {
            var drift = Math.abs((state.player.getCurrentTime() || 0) - targetOffset());
            if (drift > DRIFT_TOLERANCE) state.player.seekTo(targetOffset(), true);
        }
    }

    function resync() {
        if (!state) return;
        fetchChannels([state.channel.id], function (data) { applyProgram(data, true); }, function () {});
    }

    function showInfo() {
        if (!state || !state.root) return;
        state.root.find('.uefir-live__info').removeClass('uefir-live__info--hide');
        clearTimeout(state.hide_timer);
        state.hide_timer = setTimeout(function () {
            if (state && state.root) state.root.find('.uefir-live__info').addClass('uefir-live__info--hide');
        }, 4000);
    }

    function closeLive() {
        if (!state) return;
        var prev = state.prev_controller;

        clearInterval(state.resync_timer);
        clearTimeout(state.hide_timer);

        try { if (state.player && state.player.destroy) state.player.destroy(); } catch (e) {}
        if (state.root) state.root.remove();

        state = null;

        try { Lampa.Controller.toggle(prev || 'content'); } catch (e) {}
    }

    function registerController() {
        Lampa.Controller.add('uefir_live', {
            invisible: true,
            toggle: function () { Lampa.Controller.clear(); },
            back: closeLive,
            up: showInfo,
            down: showInfo,
            left: showInfo,
            right: showInfo,
            enter: openChannelList
        });
    }

    function buildOverlay(channel) {
        addStyle();

        var root = $(
            '<div class="uefir-live">' +
            '  <div id="uefir-live-frame" class="uefir-live__frame"></div>' +
            '  <div class="uefir-live__info">' +
            '    <div class="uefir-live__title"></div>' +
            '    <div class="uefir-live__program"></div>' +
            '    <div class="uefir-live__next"></div>' +
            '    <div class="uefir-live__switch selector">' + t('switch') + '</div>' +
            '  </div>' +
            '</div>'
        );

        $('body').append(root);

        var sw = root.find('.uefir-live__switch');
        var fire = function () { openChannelList(); };
        sw.on('hover:enter', fire);
        sw[0].addEventListener('click', fire);

        root.on('click', function (e) {
            if (!$(e.target).closest('.uefir-live__switch').length) showInfo();
        });

        return root;
    }

    function addStyle() {
        if ($('#uefir-live-style').length) return;
        $('head').append(
            '<style id="uefir-live-style">' +
            '.uefir-live{position:fixed;left:0;top:0;width:100%;height:100%;z-index:10000;background:#000;}' +
            '.uefir-live__frame{width:100%;height:100%;}' +
            '.uefir-live__frame iframe{width:100%;height:100%;border:0;}' +
            '.uefir-live__info{position:absolute;left:0;right:0;bottom:0;padding:1.5em 2em;' +
            'background:linear-gradient(transparent, rgba(0,0,0,0.85));color:#fff;' +
            'transition:opacity .3s;opacity:1;font-family:inherit;}' +
            '.uefir-live__info--hide{opacity:0;pointer-events:none;}' +
            '.uefir-live__title{font-size:1.4em;font-weight:700;}' +
            '.uefir-live__program{opacity:0.9;margin-top:.2em;}' +
            '.uefir-live__next{opacity:0.6;font-size:0.85em;margin-top:.2em;}' +
            '.uefir-live__switch{display:inline-block;margin-top:.8em;padding:.4em 1.2em;' +
            'border:0.1em solid #fff;border-radius:2em;}' +
            '.uefir-live__switch.focus{background:#fff;color:#000;}' +
            '</style>'
        );
    }

    function openLive(channel) {
        if (state) closeLive();

        var prev = 'content';
        try { prev = Lampa.Controller.enabled().name || 'content'; } catch (e) {}

        state = {
            root: buildOverlay(channel),
            player: null,
            channel: channel,
            program: null,
            next_program: null,
            fetched_at: Date.now(),
            resync_timer: null,
            hide_timer: null,
            prev_controller: prev,
            ready: false
        };

        applyProgram({ channels: [channel] }, false);

        Lampa.Controller.toggle('uefir_live');
        showInfo();

        if (!channel.program) { noty(t('live_fail')); return; }

        ytApiReady(function () {
            if (!state) return; // closed before the API finished loading

            state.player = new window.YT.Player('uefir-live-frame', {
                videoId: channel.program.videoId,
                playerVars: {
                    autoplay: 1, controls: 0, disablekb: 1, fs: 0,
                    modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3,
                    origin: window.location.origin
                },
                events: {
                    onReady: function () {
                        state.ready = true;
                        try { state.player.seekTo(targetOffset(), true); } catch (e) {}
                        try { state.player.playVideo(); } catch (e) {}
                    },
                    onError: function () { noty(t('live_fail')); }
                }
            });
        });

        state.resync_timer = setInterval(resync, RESYNC_INTERVAL);
    }

    // ---------- startup ----------

    function start() {
        registerController();

        if (!window.Lampa || !Lampa.Menu || typeof Lampa.Menu.addButton !== 'function') return;

        var icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
            'stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="13" rx="2"></rect><path d="M8 21h8"></path></svg>';

        try { Lampa.Menu.addButton(icon, t('menu'), openChannelList); } catch (e) {}
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }
})();