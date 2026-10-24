/* =====================================================================
   app.js — AgeLens logic
   ---------------------------------------------------------------------
   1. Screens & navigation (Android back button works)
   2. Loading the AI models (face detector + age estimator)
   3. Camera with a live "fit your face in the outline" guide
   4. Taking the photo and estimating the age
   5. Showing the result
   6. Install support (PWA) and offline caching

   PRIVACY: the photo only ever exists in this page's memory. Nothing is
   uploaded, stored, or sent anywhere. Leaving the result screen erases it.
   ===================================================================== */

(function () {
  "use strict";

  // Short helper: get an element by its id.
  function $(id) { return document.getElementById(id); }

  /* =================================================================
     1. SCREENS & NAVIGATION
     ================================================================= */
  var screens = { home: $("screen-home"), camera: $("screen-camera"), result: $("screen-result") };
  var currentScreen = "home";

  // Show one screen and hide the others. `push` adds a browser history
  // entry so the phone's Back gesture returns to the previous screen.
  function showScreen(name, push) {
    Object.keys(screens).forEach(function (key) { screens[key].hidden = key !== name; });
    currentScreen = name;
    if (push) history.pushState({ screen: name }, "", "#" + name);
    window.scrollTo(0, 0);
    if (name !== "camera") stopCamera();          // camera off when not needed
    if (name === "home") clearResult();          // forget the photo
  }

  // Android Back button / gesture → go to the previous screen.
  window.addEventListener("popstate", function (e) {
    var target = e.state && e.state.screen ? e.state.screen : "home";
    if (target === "camera") {
      showScreen("camera", false);
      startCamera();
    } else {
      showScreen(target, false);
    }
  });
  history.replaceState({ screen: "home" }, "", "#home");

  /* =================================================================
     2. LOADING THE AI MODELS
     -----------------------------------------------------------------
     face-api.js is a library built on TensorFlow.js. We use two of its
     pre-trained models, stored as files next to index.html:
       • tiny_face_detector_model…  finds faces (≈190 KB)
       • age_gender_model…          estimates age (≈420 KB)
     ================================================================= */
  var faceapi = window.faceapi;
  var modelsReady = null; // a Promise, so we only load once

  // quiet = true → load in the background without the spinner.
  function loadModels(quiet) {
    if (modelsReady) {
      if (!quiet) waitWithSpinner(modelsReady);
      return modelsReady;
    }
    modelsReady = (async function () {
      if (!faceapi) throw new Error("face-api.js did not load. Check that the file was uploaded.");
      // Use the phone's GPU (WebGL) when possible; fall back to the CPU.
      try { await faceapi.tf.setBackend("webgl"); } catch (e) { await faceapi.tf.setBackend("cpu"); }
      await faceapi.tf.ready();
      await faceapi.nets.tinyFaceDetector.loadFromUri("./");
      await faceapi.nets.ageGenderNet.loadFromUri("./");
    })();
    modelsReady.catch(function (err) {
      modelsReady = null; // allow a retry
      $("home-status").textContent = "Couldn't load the AI model: " + err.message;
    });
    if (!quiet) waitWithSpinner(modelsReady);
    return modelsReady;
  }

  // Show "Loading AI model…" until the models are ready (only if it takes a moment).
  function waitWithSpinner(promise) {
    var done = false;
    var timer = setTimeout(function () { if (!done) showLoader("Loading AI model…"); }, 150);
    promise.then(finish, finish);
    function finish() { done = true; clearTimeout(timer); if ($("loader-text").textContent === "Loading AI model…") hideLoader(); }
  }

  function showLoader(text) { $("loader-text").textContent = text; $("loader").hidden = false; }
  function hideLoader() { $("loader").hidden = true; }

  // Settings for the face detector.
  //   inputSize: bigger = more accurate but slower (must be a multiple of 32)
  //   scoreThreshold: how sure it must be that something is a face (0–1)
  var LIVE_OPTIONS = function () { return new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 }); };
  var PHOTO_OPTIONS = function () { return new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }); };

  /* =================================================================
     3. CAMERA + LIVE FACE GUIDE
     ================================================================= */
  var video = $("video");
  var stream = null;           // the live camera stream
  var facingMode = "user";     // "user" = front camera, "environment" = back camera
  var guideTimer = null;       // repeating face check
  var checking = false;        // true while a check is running
  var faceIsAligned = false;

  // The oval in index.html, as fractions of the viewfinder size:
  // centre (150, 190) and radii (105, 140) inside a 300 × 400 box.
  var OVAL = { cx: 150 / 300, cy: 190 / 400, rx: 105 / 300, ry: 140 / 400 };

  async function startCamera() {
    setCamStatus("Starting camera…", "");
    $("btn-capture").disabled = true;

    // Cameras only work on secure (https) pages — GitHub Pages is https.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCamStatus("This browser can't open the camera here. Open the app from its https:// address, or use “Use a Photo Instead”.", "bad");
      return;
    }
    try {
      stopCamera();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      video.srcObject = stream;
      // Mirror the front camera so it behaves like a mirror (feels natural).
      video.classList.toggle("mirrored", facingMode === "user");
      await video.play();
      await loadModels();
      setCamStatus("Fit your face inside the outline", "");
      startGuide();
    } catch (err) {
      var msg = "Couldn't start the camera. ";
      if (err && err.name === "NotAllowedError") msg = "Camera permission was denied. Allow camera access for this site in your browser settings, or go back and use a photo instead.";
      else if (err && err.name === "NotFoundError") msg = "No camera was found on this device.";
      else if (err && err.message) msg += err.message;
      setCamStatus(msg, "bad");
    }
  }

  function stopCamera() {
    clearInterval(guideTimer);
    guideTimer = null;
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); }); // turns the camera light off
      stream = null;
    }
    video.srcObject = null;
  }

  function setCamStatus(text, kind) {
    var el = $("cam-status");
    el.textContent = text;
    el.className = "cam-status" + (kind ? " " + kind : "");
  }

  // Check about 4 times a second whether a face fits the outline.
  function startGuide() {
    clearInterval(guideTimer);
    guideTimer = setInterval(checkAlignment, 250);
  }

  async function checkAlignment() {
    if (checking || !stream || video.readyState < 2) return;
    checking = true;
    try {
      var det = await faceapi.detectSingleFace(video, LIVE_OPTIONS());
      updateGuide(det);
    } catch (e) {
      /* a single failed check is harmless — try again next time */
    }
    checking = false;
  }

  // Convert the detected face box (in camera pixels) into fractions of the
  // on-screen viewfinder, remembering that the video is "cover"-cropped.
  function boxInViewfinder(box) {
    var vw = video.videoWidth, vh = video.videoHeight;
    var el = $("viewfinder");
    var W = el.clientWidth, H = el.clientHeight;
    var scale = Math.max(W / vw, H / vh);           // object-fit: cover
    var offX = (vw * scale - W) / 2, offY = (vh * scale - H) / 2;
    var cx = (box.x + box.width / 2) * scale - offX;
    var cy = (box.y + box.height / 2) * scale - offY;
    if (facingMode === "user") cx = W - cx;           // mirrored on screen
    return { cx: cx / W, cy: cy / H, w: (box.width * scale) / W, h: (box.height * scale) / H };
  }

  function updateGuide(det) {
    var oval = $("oval");
    faceIsAligned = false;
    if (!det) {
      oval.classList.remove("good");
      setCamStatus("Fit your face inside the outline", "");
      $("btn-capture").disabled = true;
      return;
    }
    var f = boxInViewfinder(det.box);
    var ovalWidth = OVAL.rx * 2;
    var sizeRatio = f.w / ovalWidth;                 // face width compared with the oval width
    var offCentre = Math.abs(f.cx - OVAL.cx) > 0.12 || Math.abs(f.cy - OVAL.cy) > 0.14;

    var msg;
    if (sizeRatio < 0.5) msg = "Move closer";
    else if (sizeRatio > 1.0) msg = "Move back a little";
    else if (offCentre) msg = "Center your face in the outline";
    else { msg = "Perfect — hold still and tap the button"; faceIsAligned = true; }

    oval.classList.toggle("good", faceIsAligned);
    setCamStatus(msg, faceIsAligned ? "good" : "");
    // A face was found, so allow a photo even if it's not perfectly aligned.
    $("btn-capture").disabled = false;
  }

  /* =================================================================
     4. TAKE THE PHOTO AND ESTIMATE THE AGE
     ================================================================= */
  var photoCanvas = document.createElement("canvas"); // holds the captured photo (memory only)

  // Copy the current camera frame into photoCanvas (un-mirrored, full size).
  function captureFrame() {
    photoCanvas.width = video.videoWidth;
    photoCanvas.height = video.videoHeight;
    var ctx = photoCanvas.getContext("2d");
    if (facingMode === "user") {
      // Save the photo the way the user saw it (mirror image), like most selfie apps.
      ctx.translate(photoCanvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Make a left-right flipped copy of a canvas.
  function mirrorOf(canvas) {
    var c = document.createElement("canvas");
    c.width = canvas.width; c.height = canvas.height;
    var ctx = c.getContext("2d");
    ctx.translate(c.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(canvas, 0, 0);
    return c;
  }

  // Run the AI on a canvas. Returns { age, box, ms } or null if no face.
  async function estimateAge(canvas) {
    var started = performance.now();
    var a = await faceapi.detectSingleFace(canvas, PHOTO_OPTIONS()).withAgeAndGender();
    if (!a) return null;
    // Second opinion on the mirror image, then average: steadier results.
    var b = await faceapi.detectSingleFace(mirrorOf(canvas), PHOTO_OPTIONS()).withAgeAndGender();
    var age = b ? (a.age + b.age) / 2 : a.age;
    // Note: the model also predicts gender. We deliberately ignore it.
    return { age: age, box: a.detection.box, score: a.detection.score, ms: performance.now() - started };
  }

  async function analysePhoto() {
    showLoader("Estimating age…");
    try {
      await loadModels(true);
      var result = await estimateAge(photoCanvas);
      hideLoader();
      showResult(result);
    } catch (err) {
      hideLoader();
      showResult(null, "Something went wrong while analysing the photo: " + err.message);
    }
  }

  // Shutter button
  $("btn-capture").addEventListener("click", function () {
    if (!stream) return;
    captureFrame();
    // Little white flash so it feels like a camera
    var flash = $("flash");
    flash.classList.remove("on"); void flash.offsetWidth; flash.classList.add("on");
    stopCamera();
    analysePhoto();
  });

  // "Use a Photo Instead": read a picture from the gallery / camera app
  $("file-input").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow choosing the same file again later
    if (!file) return;
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      // Shrink very large photos (phones take 12+ megapixel pictures).
      var scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      photoCanvas.width = Math.round(img.width * scale);
      photoCanvas.height = Math.round(img.height * scale);
      photoCanvas.getContext("2d").drawImage(img, 0, 0, photoCanvas.width, photoCanvas.height);
      URL.revokeObjectURL(url);
      analysePhoto();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      $("home-status").textContent = "That file couldn't be opened as a picture.";
    };
    img.src = url;
  });

  /* =================================================================
     5. SHOW THE RESULT
     ================================================================= */
  var RANGE = 5; // show "about ± 5 years" — the model is often off by this much or more

  function showResult(result, errorMessage) {
    showScreen("result", true);
    drawResultPhoto(result ? result.box : null);

    var ok = !!result;
    $("result-card").hidden = !ok;
    $("error-card").hidden = ok;
    if (!ok) {
      $("error-text").textContent = errorMessage ||
        "Try again with your whole face inside the outline, looking at the camera, in good light.";
      return;
    }

    var age = Math.max(1, Math.round(result.age));
    var low = Math.max(1, age - RANGE), high = age + RANGE;
    $("age-value").textContent = String(age);
    $("age-range").textContent = "Likely somewhere between " + low + " and " + high;

    // Position the dot and band on the 0–80 meter
    function pct(v) { return Math.min(100, (v / 80) * 100) + "%"; }
    $("meter-dot").style.left = pct(age);
    $("meter-band").style.left = pct(low);
    $("meter-band").style.width = "calc(" + pct(high) + " - " + pct(low) + ")";

    $("tech-info").textContent =
      "Face found with " + Math.round(result.score * 100) + "% confidence · analysed in " +
      Math.round(result.ms) + " ms on this phone (" + faceapi.tf.getBackend() + ")";
  }

  // Draw the captured photo, cropped around the face, with an oval frame.
  function drawResultPhoto(box) {
    var out = $("result-canvas");
    var ctx = out.getContext("2d");
    var W = out.width, H = out.height;            // 480 × 600 (4:5)
    ctx.fillStyle = "#0d1020";
    ctx.fillRect(0, 0, W, H);
    if (!photoCanvas.width) return;

    // Choose the source area: around the face if we have one, else the centre.
    var sw, sh, sx, sy;
    if (box) {
      sh = Math.min(photoCanvas.height, box.height * 2.0);
      sw = sh * (W / H);
      sx = box.x + box.width / 2 - sw / 2;
      sy = box.y + box.height / 2 - sh / 2 - box.height * 0.1;
    } else {
      sh = photoCanvas.height; sw = sh * (W / H);
      sx = (photoCanvas.width - sw) / 2; sy = 0;
    }
    // Keep the crop inside the photo
    sw = Math.min(sw, photoCanvas.width); sh = Math.min(sh, photoCanvas.height);
    sx = Math.max(0, Math.min(sx, photoCanvas.width - sw));
    sy = Math.max(0, Math.min(sy, photoCanvas.height - sh));
    ctx.drawImage(photoCanvas, sx, sy, sw, sh, 0, 0, W, H);

    if (box) {
      // Oval around the face
      var scale = W / sw;
      var fx = (box.x + box.width / 2 - sx) * scale, fy = (box.y + box.height / 2 - sy) * scale;
      ctx.strokeStyle = "#7cf2c5";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(fx, fy - box.height * 0.08 * scale, box.width * 0.62 * scale, box.height * 0.82 * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Wipe the photo from memory (privacy).
  function clearResult() {
    var ctx = photoCanvas.getContext("2d");
    ctx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    photoCanvas.width = 0; photoCanvas.height = 0;
    var out = $("result-canvas");
    out.getContext("2d").clearRect(0, 0, out.width, out.height);
  }

  /* =================================================================
     BUTTONS
     ================================================================= */
  $("btn-start").addEventListener("click", function () {
    $("home-status").textContent = "";
    showScreen("camera", true);
    startCamera();
  });
  $("btn-flip").addEventListener("click", function () {
    facingMode = facingMode === "user" ? "environment" : "user";
    startCamera();
  });
  $("btn-cam-back").addEventListener("click", function () { history.back(); });
  $("btn-result-back").addEventListener("click", function () { goHome(); });
  $("btn-home").addEventListener("click", function () { goHome(); });
  $("btn-retake").addEventListener("click", function () {
    clearResult();
    showScreen("camera", true);
    startCamera();
  });

  function goHome() {
    showScreen("home", true);
  }

  // Stop the camera if the app goes to the background (battery + privacy).
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopCamera();
    else if (currentScreen === "camera" && !stream) startCamera();
  });

  // Start downloading the AI model in the background right away,
  // so it's ready by the time the camera opens.
  if (faceapi) {
    setTimeout(function () { loadModels(true); }, 300);
  } else {
    $("home-status").textContent = "The AI library (face-api.js) didn't load. Check that all files were uploaded.";
  }

  /* =================================================================
     6. INSTALLABLE APP (PWA) + OFFLINE
     ================================================================= */
  // The service worker (sw.js) keeps a copy of the app on the phone,
  // so it opens instantly and works without internet after the first visit.
  var secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if ("serviceWorker" in navigator && secure) {
    navigator.serviceWorker.register("sw.js").catch(function () { /* not critical */ });
  }

  // Chrome fires this event when the app can be installed.
  var installPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    installPrompt = e;
    var hint = $("install-hint");
    hint.innerHTML = ' <button type="button" class="link-btn" id="btn-install">⬇ Install AgeLens on this phone</button>';
    $("btn-install").addEventListener("click", function () {
      installPrompt.prompt();
      installPrompt = null;
      hint.innerHTML = "";
    });
  });
})();
