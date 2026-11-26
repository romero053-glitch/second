/*
 * Lampa plugin: actor age
 * On the actor (person) card, next to the birth date shows:
 *   - alive:  current age, e.g. "21 Серпня 1967 (59 років)"
 *   - dead:   a separate line "† 12 Березня 2020 (у віці 70 років)"
 * Data comes from TMDB: person/{id} -> birthday, deathday.
 *
 * ES5 only (no arrow functions, const/let, fetch, Map) so it runs on old
 * Tizen / WebOS TV browsers. Save the file as UTF-8.
 */
(function () {
    'use strict';

    if (window.actor_age_plugin) return;
    window.actor_age_plugin = true;

    var MONTHS = {
        uk: ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'],
        ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
        en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    };

    var cache = {};     // person id -> {birthday, deathday}
    var pending = {};   // person id -> true while request is in flight
    var timer = null;

    function lang() {
        var l = 'uk';
        try { l = Lampa.Storage.get('language', 'uk') || 'uk'; } catch (e) {}
        if (l === 'uk') return 'uk';
        if (l === 'ru' || l === 'be') return 'ru';
        return 'en';
    }

    // "YYYY-MM-DD" -> {y, m, d} (no Date object, so no timezone shifts)
    function parseDate(s) {
        if (!s || typeof s !== 'string') return null;
        var p = s.split('-');
        if (p.length < 3) return null;
        var y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
        if (!y || !m || !d) return null;
        return { y: y, m: m, d: d };
    }

    function today() {
        var n = new Date();
        return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
    }

    function calcAge(from, to) {
        var a = to.y - from.y;
        if (to.m < from.m || (to.m === from.m && to.d < from.d)) a--;
        return a;
    }

    function plural(n, forms) {
        var n10 = n % 10, n100 = n % 100;
        if (n10 === 1 && n100 !== 11) return forms[0];
        if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
        return forms[2];
    }

    function years(n, l) {
        if (l === 'uk') return n + ' ' + plural(n, ['рік', 'роки', 'років']);
        if (l === 'ru') return n + ' ' + plural(n, ['год', 'года', 'лет']);
        return n + (n === 1 ? ' year' : ' years');
    }

    function formatDate(dt, l) {
        var month = MONTHS[l][dt.m - 1];
        month = month.charAt(0).toUpperCase() + month.slice(1); // same look as Lampa: "21 Серпня 1967"
        return dt.d + ' ' + month + ' ' + dt.y;
    }

    function aliveText(age, l) {
        return '(' + (l === 'en' ? years(age, l) + ' old' : years(age, l)) + ')';
    }

    function deathText(birth, death, l) {
        var age = calcAge(birth, death);
        var inAge;
        if (l === 'uk') inAge = 'у віці ' + years(age, l);
        else if (l === 'ru') inAge = 'в возрасте ' + years(age, l);
        else inAge = 'aged ' + age;
        return '\u2020 ' + formatDate(death, l) + ' (' + inAge + ')';
    }

    function tmdbUrl(id) {
        var l = 'en';
        try { l = Lampa.Storage.field('tmdb_lang') || 'en'; } catch (e) {}
        var path = 'person/' + id + '?api_key=' + Lampa.TMDB.key() + '&language=' + l;
        try { return Lampa.TMDB.api(path); } catch (e) {}
        return 'https://api.themoviedb.org/3/' + path;
    }

    function loadPerson(id, cb) {
        if (cache[id]) return cb(cache[id]);
        if (pending[id]) return;
        pending[id] = true;

        var net = new Lampa.Reguest();
        net.timeout(15000);
        net.silent(tmdbUrl(id), function (json) {
            pending[id] = false;
            if (!json) return;
            cache[id] = { birthday: json.birthday || '', deathday: json.deathday || '' };
            cb(cache[id]);
        }, function () {
            pending[id] = false;
        });
    }

    // Lampa markup: .person-start__tags > .person-start__tag > (img + div with birth date)
    function currentActor() {
        var a;
        try { a = Lampa.Activity.active(); } catch (e) { return null; }
        if (!a || a.component !== 'actor' || !a.id) return null;
        var root = null;
        try { if (a.activity && a.activity.render) root = a.activity.render(); } catch (e) {}
        if (!root || !root.length) root = $('body');
        return { id: a.id, root: root };
    }

    function apply(root, id, data) {
        var l = lang();
        var birth = parseDate(data.birthday);
        var death = parseDate(data.deathday);
        if (!birth) return;

        var tags = root.find('.person-start__tags').eq(0);
        var tag = tags.find('.person-start__tag').eq(0);
        if (!tag.length) return;
        if (tags.attr('data-actor-age') === String(id)) return;
        tags.attr('data-actor-age', String(id));
        tags.find('.actor-age-death').remove();

        var text = tag.find('div').eq(0);

        if (death) {
            var dead = $('<div class="person-start__tag actor-age-death"></div>');
            dead.text(deathText(birth, death, l));
            tags.append(dead);
        } else if (text.length) {
            text.text(text.text() + ' ' + aliveText(calcAge(birth, today()), l));
        }
    }

    function process() {
        var cur = currentActor();
        if (!cur) return;
        var tags = cur.root.find('.person-start__tags').eq(0);
        if (!tags.length || tags.attr('data-actor-age') === String(cur.id)) return;

        loadPerson(cur.id, function (data) {
            var now = currentActor();
            if (!now || now.id !== cur.id) return;
            apply(now.root, now.id, data);
        });
    }

    function schedule() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(process, 150);
    }

    function start() {
        try {
            Lampa.Listener.follow('activity', function (e) {
                if (e && (e.type === 'start' || e.type === 'archive')) schedule();
            });
        } catch (e) {}

        // The actor page is rendered asynchronously, so watch DOM changes too
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