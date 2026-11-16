// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The manager with no network (docs/BROWSER-FM1-PLAN.md phase 4): this service worker keeps the page, its modules and
// the virtual FM-1's firmware (vfm1/) in the browser, so the manager opens and the virtual FM-1 plays offline. The
// network comes first (what is served now is what runs, and is kept); the kept copy answers only when the network does
// not. FILES is everything the page loads: tools/eg/manager_test.mjs holds it against the folder, so a new module
// that is not listed fails there.
const CACHE = "evilgenius-manager-1";
const FILES = [
  "./", "index.html", "egboot.js", "egcabinet.js", "egdesk.js", "egedit.js", "egfiles.js", "eghelp.js", "eghome.js", "egkeys.js",
  "eglibrary.js", "eglink.js", "eglive.js", "egmfx.js", "egmix.js", "egpanel.js", "egpics.js", "egpool.js", "egproject.js",
  "egprojects.js", "egremote.js", "egseq.js", "egseqedit.js", "egseqnames.js", "egseqtab.js", "egsim.js", "egsimdata.js",
  "egsound.js", "egstore.js", "egsysex.js", "egtools.js", "egtransport.js", "egvalues.js", "egvirtual.js", "egwire.js",
  "manager.js", "vfm1/app.wasm", "vfm1/worklet.js", "vfm1/build.json", "../css/eg.css", "../js/px.js",
  "../js/pxart.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("evilgenius-manager-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// a kept copy: the request's own, or the same file asked with another query (?sim, ?v=..: the page is one file)
const kept = (req) => caches.open(CACHE).then((c) => c.match(req).then((r) => r || c.match(req, { ignoreSearch: true })));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  }, () => kept(req).then((r) => r || Response.error())));
});
