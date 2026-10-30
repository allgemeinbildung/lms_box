// Light or dark look of the embedded box (30.10.2026).
//
// The page is shown inside an Obsidian Publish callout, and Publish is dark on a dark device.
// The iframe cannot read the parent's theme, so the parent (vault/publish.js, block «Theme der
// LMS-Box») tells it: this script asks once ({type:'lmsbox-theme-request'}) and the parent answers
// and repeats the answer whenever the reader switches theme ({type:'lmsbox-theme', theme}).
//
// Result: html[data-theme="dark"] (css/styles.css, css/hko.css). Light is the default and the
// fallback everywhere else: opened on its own, on another host site, or with no answer. The last
// answer is kept in localStorage so the next frame paints right away instead of flashing light.
// ?theme=dark|light forces a look for local tests.
//
// Classic script in <head>, before the first paint. Never runs on the Heft look (zh.abu-hko.ch).
(function () {
    var root = document.documentElement;
    var KEY = 'lmsbox-theme';
    var embedded = window.parent !== window;

    function apply(theme) {
        if (theme === 'dark' && !root.classList.contains('heft')) root.setAttribute('data-theme', 'dark');
        else root.removeAttribute('data-theme');
    }
    function remember(theme) {
        try { localStorage.setItem(KEY, theme); } catch (e) { /* storage blocked: no flash prevention, nothing else */ }
    }

    var forced = /[?&]theme=(dark|light)(&|$)/.exec(location.search);
    if (forced) { apply(forced[1]); return; }
    if (!embedded) return;

    // Same rule as js/progress.js: only the host page's own origin, never "*". The Heft host
    // (zh.abu-hko.ch) is not on the list: it stays light.
    var HOST = 'https://lehrmittel.aburossi.ch';
    var LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/;
    var LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
    function hostOrigin() {
        var referrer = '';
        try { referrer = document.referrer ? new URL(document.referrer).origin : ''; } catch (e) { /* none */ }
        var candidates = [location.ancestorOrigins && location.ancestorOrigins[0], referrer];
        for (var i = 0; i < candidates.length; i++) {
            var o = candidates[i];
            if (o === HOST) return o;
            if (o && LOCAL_HOST.test(location.hostname) && LOCAL_ORIGIN.test(o)) return o;
        }
        return null;
    }
    var target = hostOrigin();
    if (!target) return;

    var start = 'light';
    try { start = localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { /* light */ }
    apply(start);

    window.addEventListener('message', function (event) {
        var data = event.data;
        if (event.source !== window.parent || event.origin !== target || !data || data.type !== 'lmsbox-theme') return;
        if (data.theme !== 'dark' && data.theme !== 'light') return;
        apply(data.theme);
        remember(data.theme);
    });

    function ask() { window.parent.postMessage({ type: 'lmsbox-theme-request' }, target); }
    ask();
    window.addEventListener('load', ask);
})();
