/* =====================================================================
   sw.js — service worker (makes AgeLens installable and work offline)
   ---------------------------------------------------------------------
   On first visit it saves a copy of every app file on the phone.
   After that, the app opens from that copy — even with no internet.

   IMPORTANT: when you change any file, raise the VERSION number below,
   otherwise phones may keep showing the old copy.
   ===================================================================== */
var VERSION = "agelens-v1";

// Every file the app needs (all in the same folder).
var FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "face-api.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model.bin",
  "age_gender_model-weights_manifest.json",
  "age_gender_model.bin"
];

// 1. Install: download and store all files.
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) { return cache.addAll(FILES); }).then(function () { return self.skipWaiting(); })
  );
});

// 2. Activate: delete copies from older versions.
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== VERSION; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 3. Fetch: answer from the stored copy first; fall back to the network.
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(event.request);
    })
  );
});
