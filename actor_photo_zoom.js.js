/*
 * Lampa plugin: actor photo zoom
 * On the actor (person) page the photo becomes focusable (remote / touch / mouse).
 * Press OK / tap -> the photo opens proportionally at full screen height.
 * Back / OK / tap closes it.
 *
 * ES5 only, so it works on old Tizen / WebOS TV browsers.
 */
(function () {
    'use strict';

    if (window.actor_photo_zoom_plugin) return;
    window.actor_photo_zoom_plugin = true;

    var CONTROLLER = 'actor_photo_zoom';
    var viewer = null;      // overlay element (jQuery) while open
    var prev_controller = 'content';
    var timer = null;
    var last_fire = 0;

    function addStyle() {
        if ($('#actor-photo-zoom-style').length) return;
        $('head').append(
            '<style id="actor-photo-zoom-style">' +
            '.person-start__poster.actor-photo-zoom{cursor:pointer;display:inline-block;border-radius:1em;}' +
            '.person-start__poster.actor-photo-zoom.focus .person-start__img{box-shadow:0 0 0 0.25em #fff;}' +
            '.actor-photo-viewer{position:fixed;left:0;top:0;width:100%;height:100%;z-index:10000;' +
            'background:rgba(0,0,0,0.93);display:flex;align-items:center;justify-content:center;' +
            'opacity:0;transition:opacity .25s;}' +
            '.actor-photo-viewer.actor-photo-viewer--show{opacity:1;}' +
            '.actor-photo-viewer img{height:100%;width:auto;max-width:100%;object-fit:contain;display:block;}' +
            '</style>'
        );
    }

    function bigUrl(src) {
        // TMDB image path: .../t/p/w500/abc.jpg -> .../t/p/original/abc.jpg
        if (!src || !/\/t\/p\/[^\/]+\//.test(src)) return src;
        return src.replace(/\/t\/p\/[^\/]+\//, '/t/p/original/');
    }

    function close() {
        if (!viewer) return;
        var v = viewer;
        viewer = null;
        v.removeClass('actor-photo-viewer--show');
        setTimeout(function () { v.remove(); }, 250);
        try { Lampa.Controller.toggle(prev_controller || 'content'); } catch (e) {}
    }

    function registerController() {
        Lampa.Controller.add(CONTROLLER, {
            invisible: true,
            toggle: function () {
                Lampa.Controller.clear();
            },
            enter: close,
            back: close,
            up: close,
            down: close,
            left: close,
            right: close
        });
    }

    function open(src) {
        if (viewer || !src) return;

        var big = bigUrl(src);
        var img = $('<img />');
        img.attr('src', src); // show the already loaded thumbnail instantly

        viewer = $('<div class="actor-photo-viewer"></div>').append(img);
        viewer.on('click', close);
        $('body').append(viewer);

        // upgrade to the large version when it is loaded
        if (big && big !== src) {
            var pre = new Image();
            pre.onload = function () { if (viewer && img.parent().length) img.attr('src', big); };
            pre.src = big;
        }

        setTimeout(function () { if (viewer) viewer.addClass('actor-photo-viewer--show'); }, 20);

        try {
            var cur = Lampa.Controller.enabled();
            prev_controller = cur && cur.name ? cur.name : 'content';
        } catch (e) { prev_controller = 'content'; }

        Lampa.Controller.toggle(CONTROLLER);
    }

    function isActorPage() {
        try {
            var a = Lampa.Activity.active();
            return !!(a && a.component === 'actor');
        } catch (e) { return false; }
    }

    function process() {
        if (!isActorPage()) return;

        $('.person-start__poster').each(function () {
            var poster = $(this);
            if (poster.attr('data-photo-zoom')) return;
            poster.attr('data-photo-zoom', '1');
            poster.addClass('selector actor-photo-zoom');

            var fire = function () {
                var now = Date.now();
                if (now - last_fire < 400) return; // one tap = one open (click + hover:enter)
                last_fire = now;
                open(poster.find('img').attr('src'));
            };

            // Remote / keyboard (Lampa navigator triggers hover:enter on the focused .selector)
            poster.on('hover:enter', fire);

            // Mouse / touch: Lampa binds its own click handlers only when nodes are
            // *added* to the DOM, not when a class is added later, so bind ours directly.
            poster[0].addEventListener('click', function (e) {
                e.stopPropagation();
                fire();
            });

            // Make the photo reachable with arrows / Enter right away: append it to the
            // navigation list of the current controller without resetting focus.
            try {
                if (Lampa.Controller.collectionAppend) Lampa.Controller.collectionAppend(poster[0]);
            } catch (e) {}
        });
    }

    function schedule() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(process, 100);
    }

    function start() {
        addStyle();
        registerController();

        try {
            Lampa.Listener.follow('activity', function (e) {
                if (e && (e.type === 'start' || e.type === 'archive')) schedule();
            });
        } catch (e) {}

        if (window.MutationObserver) {
            new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        } else {
            setInterval(process, 1000);
        }
        schedule();
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }
})();