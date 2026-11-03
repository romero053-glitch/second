(function () {
    'use strict';

    if (window.plugin_tmdb_full_page) return;
    window.plugin_tmdb_full_page = true;

    var TMDB_API_KEY = 'ВСТАВТЕ_СВІЙ_КЛЮЧ_TMDB_V3'; // той самий ключ, що й у плагіні слайд-шоу
    var LOGO_LANGS = ['uk', 'en']; // мови логотипів за пріоритетом
    var CERT_COUNTRIES = ['UA', 'US'];

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
            if (!key || key.indexOf('ВСТАВТЕ') === 0) { try { key = Lampa.TMDB.key(); } catch (e) {} }
            url += (url.indexOf('?') === -1 ? '?' : '&') + 'api_key=' + key;
        }
        var req = new Lampa.Reguest();
        req.silent(url, function (json) { cb(json); }, function (err, text) {
            console.log('TMDB full page: помилка запиту', url.replace(/api_key=[^&]+/, 'api_key=***'), err, text);
            cb(null);
        });
    }

    var cache = {};

    function loadDetails(type, id, cb) {
        var key = type + id;
        if (cache[key]) { cb(cache[key]); return; }
        var append = type === 'tv' ? 'images,content_ratings' : 'images,release_dates';
        apiGet(type + '/' + id + '?language=' + lang() + '&append_to_response=' + append +
            '&include_image_language=' + LOGO_LANGS.join(',') + ',null', function (json) {
            if (json) cache[key] = json;
            cb(json);
        });
    }

    /* ---------- Допоміжне ---------- */

    function esc(s) {
        return String(s || '').replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function find(render, sel) {
        return render.filter(sel).add(render.find(sel));
    }

    function pickLogo(details) {
        var list = details && details.images && details.images.logos;
        if (!list || !list.length) return null;
        for (var i = 0; i < LOGO_LANGS.length; i++) {
            var lg = LOGO_LANGS[i];
            var found = list.filter(function (l) { return l.iso_639_1 === lg; });
            if (found.length) {
                found.sort(function (a, b) { return (b.vote_average || 0) - (a.vote_average || 0); });
                var p = found[0].file_path;
                return imgUrl(/\.svg$/i.test(p) ? 'original' : 'w500', p);
            }
        }
        return null;
    }

    function pickCert(details, type) {
        try {
            if (type === 'tv') {
                var cr = (details.content_ratings && details.content_ratings.results) || [];
                for (var i = 0; i < CERT_COUNTRIES.length; i++) {
                    var f = cr.filter(function (r) { return r.iso_3166_1 === CERT_COUNTRIES[i] && r.rating; })[0];
                    if (f) return f.rating;
                }
            } else {
                var rd = (details.release_dates && details.release_dates.results) || [];
                for (var j = 0; j < CERT_COUNTRIES.length; j++) {
                    var c = rd.filter(function (r) { return r.iso_3166_1 === CERT_COUNTRIES[j]; })[0];
                    if (c) {
                        var cert = (c.release_dates || []).map(function (x) { return x.certification; }).filter(Boolean)[0];
                        if (cert) return cert;
                    }
                }
            }
        } catch (e) {}
        return '';
    }

    function runtimeText(min) {
        if (!min) return '';
        var h = Math.floor(min / 60), m = min % 60;
        return (h ? h + ' г ' : '') + (m ? m + ' хв' : '');
    }

    function metaHtml(movie, type, details) {
        var parts = [];
        var date = movie.release_date || movie.first_air_date || '';
        if (date) parts.push('<span>' + date.slice(0, 4) + '</span>');

        if (details) {
            if (type === 'tv') {
                if (details.number_of_seasons) parts.push('<span>' + details.number_of_seasons + ' сез.</span>');
                var ep = details.episode_run_time && details.episode_run_time[0];
                if (ep) parts.push('<span>' + runtimeText(ep) + '</span>');
            } else if (details.runtime) {
                parts.push('<span>' + runtimeText(details.runtime) + '</span>');
            }
            var cert = pickCert(details, type);
            if (cert) parts.push('<span class="tps-cert">' + esc(cert) + '</span>');
        }

        var vote = (details && details.vote_average) || movie.vote_average;
        if (vote) parts.push('<span class="tps-star"><b>★</b> ' + Number(vote).toFixed(1) + '</span>');

        return parts.join('');
    }

    /* ---------- Фон на всю сторінку ---------- */

    var bgEl = null;

    function ensureBg() {
        if (bgEl) return;
        bgEl = $('<div class="tps-full-bg"><div class="tps-full-bg-img"></div><div class="tps-full-bg-shade"></div></div>');
        $('body').append(bgEl);

        // показуємо фон лише коли на екрані видно сторінку фільму
        setInterval(function () {
            var vis = $('.tps-fs:visible').last();
            if (!vis.length) { bgEl.css('display', 'none'); return; }
            bgEl.css('display', 'block');
            var url = vis.data('tps-bg') || '';
            var img = bgEl.find('.tps-full-bg-img');
            if (img.data('url') !== url) {
                img.data('url', url).css('opacity', 0);
                if (url) {
                    var im = new Image();
                    im.onload = function () {
                        if (img.data('url') === url) img.css({ 'background-image': 'url(' + url + ')', 'opacity': 1 });
                    };
                    im.src = url;
                }
            }
        }, 400);
    }

    /* ---------- Основна логіка ---------- */

    function apply(e) {
        var render = e.object.activity.render();
        var movie = e.data && e.data.movie;
        if (!movie) return;

        var roots = find(render, '.full-start-new, .full-start');
        if (!roots.length || roots.first().hasClass('tps-fs')) return;

        var type = (e.object.method === 'tv' || (movie.name && !movie.title)) ? 'tv' : 'movie';
        var title = movie.title || movie.name || '';

        roots.addClass('tps-fs');
        find(render, '.full-start__background').addClass('tps-hide');

        // фон: кадр із фільму (або постер, якщо кадру немає)
        var bg = movie.backdrop_path ? imgUrl('w1280', movie.backdrop_path)
               : (movie.poster_path ? imgUrl('w780', movie.poster_path) : '');
        roots.first().data('tps-bg', bg);
        ensureBg();

        // блок "логотип + мета" над кнопками
        var head = $(
            '<div class="tps-head">' +
                '<div class="tps-logo-wrap"><div class="tps-title-text">' + esc(title) + '</div></div>' +
                '<div class="tps-meta">' + metaHtml(movie, type, null) + '</div>' +
            '</div>'
        );

        // блок "слоган + опис + жанри" під кнопками
        var foot = $(
            '<div class="tps-foot">' +
                (movie.tagline ? '<div class="tps-tagline">' + esc(movie.tagline) + '</div>' : '') +
                (movie.overview ? '<div class="tps-overview">' + esc(movie.overview) + '</div>' : '') +
                '<div class="tps-chips"></div>' +
            '</div>'
        );

        var buttons = find(render, '.full-start-new__buttons, .full-start__buttons').first();
        if (buttons.length) {
            head.insertBefore(buttons);
            foot.insertAfter(buttons);
        } else {
            var right = find(render, '.full-start-new__right, .full-start__right').first();
            if (!right.length) right = roots.first();
            right.prepend(head);
            right.append(foot);
        }

        // догружаємо логотип, вік, тривалість, жанри
        loadDetails(type, movie.id, function (details) {
            if (!details || !head.closest('body').length && !head.parent().length) return;

            head.find('.tps-meta').html(metaHtml(movie, type, details));

            var logo = pickLogo(details);
            if (logo) {
                var li = new Image();
                li.onload = function () {
                    head.find('.tps-logo-wrap').html('<img class="tps-logo" src="' + logo + '" />');
                };
                li.src = logo;
            }

            if (!movie.tagline && details.tagline) {
                foot.prepend('<div class="tps-tagline">' + esc(details.tagline) + '</div>');
            }
            if (!movie.overview && details.overview) {
                foot.find('.tps-chips').before('<div class="tps-overview">' + esc(details.overview) + '</div>');
            }

            var chips = (details.genres || []).map(function (g) {
                return '<span class="tps-chip">' + esc(g.name) + '</span>';
            }).join('');
            foot.find('.tps-chips').html(chips);
        });
    }

    function addStyles() {
        if ($('#tps-full-style').length) return;
        $('head').append(
            '<style id="tps-full-style">' +
            '.tps-full-bg{position:fixed;left:0;top:0;right:0;bottom:0;z-index:-1;display:none;background:#0a0e14;}' +
            '.tps-full-bg-img{position:absolute;left:0;top:0;right:0;bottom:0;background-size:cover;background-position:center top;' +
                'opacity:0;transition:opacity .5s ease;}' +
            '.tps-full-bg-shade{position:absolute;left:0;top:0;right:0;bottom:0;' +
                'background:linear-gradient(to top,rgba(10,14,20,.98) 0%,rgba(10,14,20,.85) 30%,rgba(10,14,20,.2) 62%,rgba(10,14,20,.4) 100%);}' +
            '.tps-hide{display:none!important;}' +

            '.tps-fs{display:flex!important;align-items:flex-end;min-height:88vh;background:none!important;}' +
            '.tps-fs .full-start-new__left,.tps-fs .full-start__left{display:none!important;}' +
            '.tps-fs .full-start-new__body,.tps-fs .full-start__body{width:100%;display:block;margin:0;padding:0;}' +
            '.tps-fs .full-start-new__right,.tps-fs .full-start__right{width:100%;display:flex;flex-direction:column;' +
                'align-items:center;margin:0;padding:0 3%;box-sizing:border-box;}' +
            '.tps-fs .full-start-new__title,.tps-fs .full-start__title,' +
            '.tps-fs .full-start-new__head,.tps-fs .full-start__head,' +
            '.tps-fs .full-start-new__tagline,.tps-fs .full-start__tagline,' +
            '.tps-fs .full-start-new__details,.tps-fs .full-start__details,' +
            '.tps-fs .full-start-new__rate-line,.tps-fs .full-start__rate-line{display:none!important;}' +
            '.tps-fs .full-start-new__buttons,.tps-fs .full-start__buttons{display:flex;flex-wrap:wrap;justify-content:center;margin:.6em 0;}' +

            '.tps-head{width:100%;text-align:center;}' +
            '.tps-logo-wrap{display:flex;justify-content:center;}' +
            '.tps-logo{max-width:60%;max-height:11em;object-fit:contain;filter:drop-shadow(0 0 .5em rgba(0,0,0,.6));}' +
            '.tps-title-text{font-size:3em;font-weight:700;line-height:1.1;text-shadow:0 .1em .4em rgba(0,0,0,.7);}' +
            '.tps-meta{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;margin-top:1em;font-size:1.3em;opacity:.95;}' +
            '.tps-meta>span{margin:0 .6em;}' +
            '.tps-cert{border:.1em solid rgba(255,255,255,.7);border-radius:.25em;padding:0 .35em;font-size:.8em;font-weight:700;}' +
            '.tps-star b{color:#3ec6e0;}' +

            '.tps-foot{width:100%;margin-top:1.2em;text-align:left;}' +
            '.tps-tagline{font-size:1.5em;font-style:italic;}' +
            '.tps-overview{margin-top:.4em;font-size:1.2em;line-height:1.45;opacity:.8;max-width:70em;}' +
            '.tps-chip{display:inline-block;margin:.8em .5em 0 0;padding:.2em .7em;border-radius:.3em;' +
                'background:rgba(255,255,255,.14);font-size:1.05em;font-weight:700;}' +
            '</style>'
        );
    }

    function init() {
        addStyles();
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') {
                try { apply(e); } catch (err) { console.log('TMDB full page:', err); }
            }
        });
    }

    if (window.appready) init();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }
})();
