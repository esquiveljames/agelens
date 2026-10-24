# AgeLens — AI Age Guess

A small Android-installable app: it opens the front camera with an **oval outline to fit your face**, takes a photo, and an **on-device AI model** estimates the person's age from their facial features.

- 📷 Live face guide — the outline turns green and says *"Perfect — hold still"* when your face is centered and the right size ("Move closer", "Move back a little", "Center your face" otherwise)
- 🤖 Two small pre-trained neural networks run **on the phone** with TensorFlow.js — no server, no API key, no cost
- 📊 Result: estimated age, a "likely between" range (± 5 years), and a 0–80 meter
- 🖼️ "Use a Photo Instead" for when the camera isn't available
- 🔒 Photo is never uploaded or saved; it's erased when you leave the result screen
- 📲 Installable (own icon, full screen, works **offline** after the first visit)

> AgeLens is an installable web app (PWA). It installs on Android from Chrome like a regular app. If you need an actual `.apk` file, see [Getting a real APK file](#getting-a-real-apk-file-optional).

---

## Files (all in one folder — no sub-folders)

| File | Purpose |
|---|---|
| `index.html` | The three screens: Home, Camera, Result |
| `styles.css` | Look and layout (phone-first) |
| `app.js` | Camera, face-outline guide, photo capture, age estimation, results |
| `face-api.js` | AI library (face-api by Vladimir Mandic, MIT; includes TensorFlow.js) |
| `tiny_face_detector_model-weights_manifest.json` + `tiny_face_detector_model.bin` | Face detector model (~190 KB) |
| `age_gender_model-weights_manifest.json` + `age_gender_model.bin` | Age estimation model (~420 KB) |
| `manifest.webmanifest` | Makes the app installable (name, icon, colors) |
| `sw.js` | Service worker: stores the app on the phone for offline use |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | App icons |
| `LICENSE`, `LICENSE-face-api.txt`, `README.md`, `.nojekyll` | License and docs |

Total download ≈ 2 MB.

## Put it on your phone (free, via GitHub Pages)

The camera only works on **https** pages, so the app has to be hosted. GitHub Pages is free and https.

1. On GitHub: **+ → New repository** → name it `agelens` → **Public** → **Create repository**.
2. Click **uploading an existing file**. Unzip `agelens.zip`, select **all the files**, and drag them in (there are no folders). Click **Commit changes**.
   - `.nojekyll` is hidden on some computers; the app works without it.
3. **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main**, **/ (root)** → **Save**.
4. After 1–3 minutes your app is at **`https://YOUR-USERNAME.github.io/agelens/`**.

### Install it on Android

1. Open that address in **Chrome** on the phone.
2. Tap **Install AgeLens on this phone** at the bottom of the home screen, or Chrome's **⋮ menu → Install app** (older versions: **Add to Home screen**).
3. AgeLens now has its own icon in the app drawer, opens full screen without the address bar, and works offline.
4. The first time you tap **Start Camera**, allow camera access.

## Getting a real APK file (optional)

My build workspace can't reach Google's Android SDK servers, so I couldn't compile an `.apk` directly. PWABuilder (free, by Microsoft) can wrap your hosted app into one:

1. Host the app first (steps above).
2. Go to **<https://www.pwabuilder.com>**, paste `https://YOUR-USERNAME.github.io/agelens/`, and start.
3. Choose the **Android** package, and in the Android options ask for a **signed** APK. Download the zip; it contains the `.apk` and a signing key — keep the key if you'll update the app later.
4. Copy the `.apk` to your phone, open it, and allow **Install unknown apps** for your file manager when asked.

Notes:
- The APK is a "Trusted Web Activity": it opens your GitHub Pages site inside a full-screen Chrome view. It needs internet on first launch, then works offline.
- Without a "digital asset links" file on your domain, the APK may show a thin address bar at the top. Removing it requires uploading `assetlinks.json` to `/.well-known/` at your domain root — for GitHub Pages that means a repository named `YOUR-USERNAME.github.io`. The installed PWA (previous section) has no address bar and needs none of this.
- I couldn't test PWABuilder from here; its screens may differ slightly from these steps.

## How it works

1. **Camera + outline.** About four times a second, the **Tiny Face Detector** (a small convolutional network) finds the face in the live video. `app.js` converts the face box to screen coordinates and checks it against the oval: size and centering → the hint text and green outline.
2. **Photo.** Tapping the shutter copies one video frame into memory (a `<canvas>`) and turns the camera off.
3. **Age estimate.** The face is detected again at higher resolution, cropped, and passed to **AgeGenderNet**, a small CNN trained on public face photo datasets. It outputs an age as a number (regression, not categories).
4. **Steadier result.** The app also runs the model on the mirror image and averages the two estimates.
5. The model also predicts gender; **the app deliberately ignores and never shows it**.

Inference runs on the phone's GPU through WebGL (falling back to CPU). The result screen shows the face-detection confidence and how long the analysis took on that phone.

## Accuracy and responsible use

- The estimate is often **off by 5 or more years**. Lighting, glasses, makeup, beards, expression, head angle, and camera quality all change it.
- In testing with a public-domain NASA astronaut portrait of an adult woman, the app estimated **30–31**. That is probably younger than she was when photographed. Studio-lit, smooth-skinned portraits often get younger estimates.
- Models like this learn from photo collections that don't represent all ages and ethnicities equally, so they can be **less accurate for some groups**, especially children and older adults.
- **Never use it to verify anyone's real age** (e.g., for age-restricted content). It's for fun and for learning how AI vision works.
- A photo of a face is personal data. The app processes it only in the phone's memory and never stores or transmits it. If you demo it in class, take photos only of people who agree to it.

## Testing done (Oct 24, 2026)

Automated headless Chrome at phone size (390 × 844), with a **fake camera** that streamed a public-domain NASA portrait (from scikit-image's sample data). All 29 checks passed:

- Models load and the camera stream plays.
- The outline turns green with "Perfect — hold still", and the shutter enables.
- Taking a photo shows an age (31), a range, and the tech info, and the camera turns off.
- The result photo is drawn and gender is never shown.
- Take Another, switch camera, and Back all work; the camera stops and the photo is wiped when leaving.
- "Use a Photo Instead" works, and a picture with no face shows "No face found".
- Chrome reports no installability errors and the manifest parses cleanly.
- The service worker controls the page, and the app opens and estimates age **offline**.
- There are no JavaScript errors, no requests to other servers, and no sideways scrolling.
- A denied camera permission shows a clear message.

**Not tested:** a real Android phone or camera, real-world speed on phone GPUs, and the PWABuilder APK route.

## Ideas for extending it (not implemented)

- Show *which* parts of the face influenced the estimate (saliency maps) — a good explainable-AI lesson.
- Compare two models side by side (e.g., Human library's FaceRes) to discuss model disagreement.
- Average the estimate over several frames instead of one photo.

## Licenses

- AgeLens code: MIT (see `LICENSE`; replace the placeholder name).
- face-api.js and its models: MIT, © Vladimir Mandic (`LICENSE-face-api.txt`), based on the original face-api.js by Vincent Mühler (MIT). Includes TensorFlow.js (Apache 2.0).
