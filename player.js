/* =========================================================
   Lettore audio persistente — DJ Carlos

   Il lettore vive fuori dal contenuto della pagina: i link interni
   caricano la nuova pagina senza ricaricare il browser (sostituiscono
   header, contenuto e stili), così la musica non si interrompe.

   - Nella pagina Mix il lettore completo compare nello spazio #player-slot.
   - Altrove (o quando quello spazio esce dallo schermo) resta visibile
     la barra compatta in basso; cliccandola il lettore si espande.

   Gli script delle pagine sono <script type="module"> e registrano gli
   ascoltatori su window/document con { signal: window.pageSignal },
   così vengono rimossi a ogni cambio pagina.
   ========================================================= */
(() => {
  if (window.djPlayer) return;

  // Brani da Pixabay (Licenza per i contenuti di Pixabay), con il loro autore
  const PLAYLIST = [
    { title: "Latin",           artist: "The_Mountain", file: "audio/latin.mp3" },
    { title: "Latin Jazz",      artist: "alex-morgan",  file: "audio/latin-jazz.mp3" },
    { title: "Brazilian Phonk", artist: "alex-morgan",  file: "audio/brazilian-phonk.mp3" },
    { title: "Blue Skies Only", artist: "vibemode",     file: "audio/blue-skies-only.mp3" },
    { title: "Background Pop",  artist: "kulakovka",    file: "audio/background-pop.mp3" }
  ];

  const MODES = ["shuffle", "all", "one"];
  const MODE_NAMES = { shuffle: "Shuffle", all: "Repeat All", one: "Repeat One" };

  const svg = (cls, d) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON = {
    play:      svg("i-play", "M8 5v14l11-7z"),
    pause:     svg("i-pause", "M6 5h4v14H6zM14 5h4v14h-4z"),
    prev:      svg("", "M6 5h2v14H6zM20 5v14L9 12z"),
    next:      svg("", "M16 5h2v14h-2zM4 5v14l11-7z"),
    shuffle:   svg("i-shuffle", "M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"),
    repeat:    svg("i-repeat", "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"),
    repeatOne: svg("i-repeat-one", "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"),
    vol:       svg("i-vol", "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"),
    mute:      svg("i-mute", "M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"),
    up:        svg("", "M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z"),
    down:      svg("", "M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z")
  };

  // Ascoltatori della pagina corrente: annullati a ogni cambio pagina
  let pageCtrl = new AbortController();
  window.pageSignal = pageCtrl.signal;

  const root = document.documentElement;

  // Con file:// il browser blocca sia la lettura delle altre pagine sia
  // l'analisi dell'audio (lo renderebbe muto): servono http/https.
  const isHttp = location.protocol === "http:" || location.protocol === "https:";

  // ---------- Elementi persistenti ----------
  // Due "piatti" che si alternano: durante il cambio brano uno sfuma in uscita
  // mentre l'altro entra (dissolvenza incrociata). `audio` è sempre quello corrente.
  const makeDeck = () => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.setAttribute("data-persist", "");
    a._fade = 1;       // livello della dissolvenza (0–1), moltiplicato per il volume
    a._fadeTimer = 0;
    return a;
  };
  const decks = [makeDeck(), makeDeck()];
  let audio = decks[0];

  const player = document.createElement("section");
  player.className = "player";
  player.setAttribute("aria-label", "Lettore audio");
  player.innerHTML = `
    <div class="deck">
      <div class="vinyl-wrap" aria-hidden="true">
        <div class="vinyl"><div class="label"></div></div>
      </div>

      <div class="now">
        <span class="now-tag"><span class="mini-eq" aria-hidden="true"><i></i><i></i><i></i></span> In riproduzione</span>
        <h2 class="now-title">—</h2>
        <p class="now-artist">—</p>
      </div>

      <div class="progress">
        <canvas class="viz" aria-hidden="true"></canvas>
        <input type="range" class="range pl-seek" min="0" max="0" step="0.1" value="0" aria-label="Posizione nel brano">
        <div class="times">
          <span class="pl-cur">0:00</span>
          <span class="pl-dur">0:00</span>
        </div>
      </div>

      <div class="controls">
        <button class="ctrl pl-prev" type="button" aria-label="Brano precedente">${ICON.prev}</button>
        <button class="ctrl play pl-play" type="button" aria-label="Riproduci">${ICON.play}${ICON.pause}</button>
        <button class="ctrl pl-next" type="button" aria-label="Brano successivo">${ICON.next}</button>
        <button class="mode-btn" type="button" data-mode="all" aria-label="Modalità: Repeat All">
          ${ICON.shuffle}${ICON.repeat}${ICON.repeatOne}
        </button>
      </div>
      <p class="mode-label" aria-live="polite">Repeat All</p>

      <div class="volume">
        <button class="icon-btn pl-mute" type="button" aria-label="Disattiva audio">${ICON.vol}${ICON.mute}</button>
        <input type="range" class="range pl-vol" min="0" max="1" step="0.01" value="0.8" aria-label="Volume">
      </div>

      <p class="pl-error" role="status"></p>
    </div>

    <div class="playlist">
      <div class="playlist-head">
        <h2>Playlist</h2>
        <span>${PLAYLIST.length} brani</span>
      </div>
      <ol class="tracks">
        ${PLAYLIST.map((t, i) => `
          <li>
            <button class="track" type="button" data-i="${i}">
              <span class="track-num">${i + 1}</span>
              <span class="mini-eq" aria-hidden="true"><i></i><i></i><i></i></span>
              <span>
                <span class="track-title">${t.title}</span>
                <span class="track-artist">${t.artist}</span>
              </span>
              <span class="track-dur">–:––</span>
            </button>
          </li>`).join("")}
      </ol>
    </div>`;

  const mini = document.createElement("div");
  mini.className = "mini";
  mini.setAttribute("data-persist", "");
  mini.setAttribute("aria-label", "Lettore compatto");
  mini.setAttribute("role", "region");
  mini.innerHTML = `
    <div class="mini-row">
      <button class="mini-info" type="button" aria-label="Espandi il lettore">
        <span class="mini-disc" aria-hidden="true"></span>
        <span class="mini-text">
          <span class="mini-title">—</span>
          <span class="mini-artist">—</span>
        </span>
      </button>
      <span class="mini-time"><span class="mini-cur">0:00</span> / <span class="mini-dur">0:00</span></span>
      <button class="mini-play" type="button" aria-label="Riproduci">${ICON.play}${ICON.pause}</button>
      <button class="mini-expand" type="button" aria-label="Espandi il lettore">${ICON.up}</button>
    </div>
    <input type="range" class="range mini-seek" min="0" max="0" step="0.1" value="0" aria-label="Posizione nel brano">`;

  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("data-persist", "");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Lettore audio");
  sheet.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet-panel">
      <button class="sheet-close" type="button" aria-label="Riduci il lettore">${ICON.down}</button>
      <div class="sheet-body"></div>
    </div>`;

  document.body.append(sheet, mini, ...decks);

  const $p = s => player.querySelector(s);
  const $m = s => mini.querySelector(s);
  const seeks = [$p(".pl-seek"), $m(".mini-seek")];
  const curs = [$p(".pl-cur"), $m(".mini-cur")];
  const durs = [$p(".pl-dur"), $m(".mini-dur")];
  const playBtns = [$p(".pl-play"), $m(".mini-play")];
  const volBox = $p(".volume");
  const vol = $p(".pl-vol");
  const trackBtns = [...player.querySelectorAll(".track")];

  // ---------- Stato ----------
  let index = 0;
  let seeking = false;
  let started = false;      // l'utente ha avviato la musica almeno una volta
  let playerVisible = false;
  let sheetOpen = false;
  let durationsLoaded = false;
  let mode = "all";
  let order = [];           // coda casuale: order[pos] è il brano corrente
  let pos = 0;

  const fmt = s => {
    if (!isFinite(s)) return "0:00";
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  };

  const setFill = input => {
    const max = parseFloat(input.max) || 0;
    const pct = max ? (parseFloat(input.value) / max) * 100 : 0;
    input.style.setProperty("--fill", pct + "%");
  };

  function showTime(t) {
    seeks.forEach(r => { r.value = t; setFill(r); });
    curs.forEach(el => { el.textContent = fmt(t); });
  }

  function loadDurations() {
    if (durationsLoaded) return;
    durationsLoaded = true;
    PLAYLIST.forEach((t, i) => {
      const a = new Audio();
      a.preload = "metadata";
      a.src = encodeURI(t.file);
      a.addEventListener("loadedmetadata", () => {
        trackBtns[i].querySelector(".track-dur").textContent = fmt(a.duration);
      });
    });
  }

  // ---------- Visualizzatore delle frequenze (Web Audio API) ----------
  const canvas = $p(".viz");
  const ctx2d = canvas.getContext("2d");
  const AC = window.AudioContext || window.webkitAudioContext;
  // Su iPhone/iPad l'audio che passa dalla Web Audio API viene silenziato dall'interruttore
  // laterale "silenzioso"; solo da iOS 17 (navigator.audioSession) lo si può evitare.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // Grafo audio: serve al visualizzatore e a regolare il volume dove l'elemento
  // audio non lo permette (iOS). Con file:// la Web Audio API riceverebbe solo silenzio.
  const graphOn = isHttp && !!AC && !(isIOS && !("audioSession" in navigator));
  const vizOn = graphOn && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const BAR_GAP = 3;
  let actx = null;
  let analyser = null;
  let freq = null;
  let heights = [];
  let rafId = 0;

  if (!vizOn) canvas.hidden = true;

  // Il grafo audio si crea al primo play (i browser lo consentono solo dopo un gesto dell'utente)
  // Ogni piatto: sorgente → guadagno (volume) → analizzatore (se attivo) → uscita
  function initAudioGraph() {
    if (!graphOn || actx) return;
    try {
      actx = new AC();
      let out = actx.destination;
      if (vizOn) {
        analyser = actx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyser.connect(actx.destination);
        freq = new Uint8Array(analyser.frequencyBinCount);
        out = analyser;
      }
      decks.forEach(d => {
        const gain = actx.createGain();
        actx.createMediaElementSource(d).connect(gain);
        gain.connect(out);
        d._gain = gain;
      });
      decks.forEach(applyVolume);
    } catch (e) {
      analyser = null;
    }
  }

  function drawViz() {
    rafId = 0;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return; // lettore non visibile: riparte con startViz()

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, w, h);

    const count = Math.max(16, Math.min(64, Math.floor(w / 9)));
    const barW = (w - BAR_GAP * (count - 1)) / count;
    const live = analyser && !audio.paused;
    if (live) analyser.getByteFrequencyData(freq);
    // Le frequenze più alte sono quasi sempre vuote: si usa il primo 75%
    const usable = freq ? Math.floor(freq.length * 0.75) : 0;

    const grad = ctx2d.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, "#8B5CF6");
    grad.addColorStop(1, "#EC4899");
    ctx2d.fillStyle = grad;
    ctx2d.shadowColor = "rgba(236, 72, 153, 0.55)";
    ctx2d.shadowBlur = 8;

    let moving = false;
    for (let i = 0; i < count; i++) {
      let target = 0;
      if (live) {
        // Distribuzione logaritmica: più barre dedicate alle basse frequenze
        const a = Math.floor(Math.pow(i / count, 1.6) * usable);
        const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / count, 1.6) * usable));
        let sum = 0;
        for (let k = a; k < b; k++) sum += freq[k];
        target = sum / (b - a) / 255;
      }
      // Salita immediata, discesa morbida
      const v = Math.max(target, (heights[i] || 0) * 0.9);
      heights[i] = v;
      if (v > 0.005) moving = true;

      const bh = Math.max(2, v * h);
      const x = i * (barW + BAR_GAP);
      const r = Math.min(barW / 2, 3);
      ctx2d.beginPath();
      if (ctx2d.roundRect) ctx2d.roundRect(x, h - bh, barW, bh, [r, r, 0, 0]);
      else ctx2d.rect(x, h - bh, barW, bh);
      ctx2d.fill();
    }

    // Continua mentre suona o finché le barre non sono tornate giù dopo la pausa
    if (live || moving) rafId = requestAnimationFrame(drawViz);
  }

  function startViz() {
    if (vizOn && !rafId) rafId = requestAnimationFrame(drawViz);
  }

  // ---------- Volume e dissolvenza incrociata ----------
  const FADE_MS = 500;
  let masterVol = 0.8;
  let muted = false;

  // Su iOS il volume degli elementi audio è di sola lettura: lì volume e
  // dissolvenza passano dal guadagno del grafo audio, se disponibile
  const elementVolume = (() => {
    const a = document.createElement("audio");
    a.volume = 0.5;
    return a.volume === 0.5;
  })();
  const canFade = () => elementVolume || !!audio._gain;

  // Su iPhone/iPad il volume si regola con i tasti del dispositivo: la barra
  // si nasconde (anche dove il volume non è regolabile in nessun modo)
  const volumeHidden = isIOS || (!elementVolume && !graphOn);
  if (volumeHidden) volBox.style.display = "none";

  function applyVolume(d) {
    const v = Math.max(0, Math.min(1, masterVol * d._fade));
    if (d._gain) {
      d._gain.gain.value = v;
      d.volume = 1;
    } else {
      d.volume = v;
    }
    d.muted = muted;
  }

  function stopFade(d) {
    clearInterval(d._fadeTimer);
    d._fadeTimer = 0;
  }

  // Curva a potenza costante (seno/coseno): il volume percepito resta uniforme.
  // setInterval e non requestAnimationFrame, così la dissolvenza termina
  // anche con la scheda in background.
  function fadeTo(d, target, done) {
    stopFade(d);
    const from = d._fade;
    const t0 = performance.now();
    d._fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / FADE_MS);
      d._fade = target > from
        ? from + (target - from) * Math.sin(k * Math.PI / 2)
        : target + (from - target) * Math.cos(k * Math.PI / 2);
      applyVolume(d);
      if (k === 1) {
        stopFade(d);
        if (done) done();
      }
    }, 16);
  }

  // Ferma il piatto non corrente (ad esempio se sta ancora sfumando)
  function silenceOther() {
    decks.forEach(d => {
      if (d === audio) return;
      stopFade(d);
      d.pause();
    });
  }

  // ---------- Sblocco audio su mobile ----------
  // I browser mobili consentono l'audio solo dopo un tocco dell'utente. Al primo
  // caricamento su touch screen compare "Tocca per riprodurre": quel tocco avvia
  // la musica e sblocca l'audio per il resto della sessione.
  const isTouch = matchMedia("(pointer: coarse)").matches;
  let unlocked = false;

  const gate = document.createElement("div");
  gate.className = "tap-gate";
  gate.setAttribute("data-persist", "");
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-modal", "true");
  gate.setAttribute("aria-label", "Attiva l'audio");
  gate.innerHTML = `
    <button class="tap-btn" type="button">
      <span class="tap-ring">${ICON.play}</span>
      <span class="tap-text">Tocca per riprodurre</span>
      <span class="tap-sub">DJ Carlos Mix</span>
    </button>
    <button class="tap-skip" type="button">Entra senza audio</button>`;
  document.body.appendChild(gate);

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try { sessionStorage.setItem("djc-unlocked", "1"); } catch (e) {}
    // iOS 17+: l'audio non viene silenziato dall'interruttore laterale
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
    initAudioGraph();
    if (actx && actx.state !== "running") actx.resume().catch(() => {});
  }

  function showGate() {
    gate.classList.add("show");
    document.body.style.overflow = "hidden";
    gate.querySelector(".tap-btn").focus({ preventScroll: true });
  }

  function hideGate() {
    if (!gate.classList.contains("show")) return;
    gate.classList.remove("show");
    if (!sheetOpen) document.body.style.overflow = "";
  }

  gate.querySelector(".tap-btn").addEventListener("click", () => {
    play();
    hideGate();
  });
  gate.querySelector(".tap-skip").addEventListener("click", () => {
    unlock();
    hideGate();
  });

  // ---------- Riproduzione ----------
  function load(i, autoplay) {
    index = (i + PLAYLIST.length) % PLAYLIST.length;
    const t = PLAYLIST[index];

    const old = audio;
    const crossfade = canFade() && autoplay && !old.paused;

    if (crossfade) {
      // Il nuovo brano va sull'altro piatto; il corrente sfuma in uscita,
      // poi si ferma e libera il file
      audio = decks[0] === old ? decks[1] : decks[0];
      stopFade(audio);
      audio.pause();
      fadeTo(old, 0, () => {
        old.pause();
        old.removeAttribute("src");
        old.load();
      });
      audio._fade = 0;
    } else {
      // Senza dissolvenza (fine brano, lettore in pausa, iOS) si resta sullo
      // stesso elemento audio: è quello già attivato dal tocco dell'utente,
      // quindi i browser mobili lo lasciano proseguire da solo
      silenceOther();
      stopFade(audio);
      audio.pause();
      audio._fade = 1;
    }

    audio.src = encodeURI(t.file);
    decks.forEach(d => { d.loop = d === audio && mode === "one"; });
    applyVolume(audio);

    $p(".now-title").textContent = t.title;
    $m(".mini-title").textContent = t.title;
    $p(".now-artist").textContent = t.artist;
    $m(".mini-artist").textContent = t.artist;
    $p(".pl-error").textContent = "";
    seeks.forEach(r => { r.max = 0; });
    showTime(0);
    durs.forEach(el => { el.textContent = "0:00"; });

    trackBtns.forEach((b, j) => {
      b.classList.toggle("current", j === index);
      b.setAttribute("aria-current", j === index ? "true" : "false");
    });

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: "DJ Carlos — Mix" });
    }

    if (autoplay) play();
    if (crossfade) fadeTo(audio, 1);
  }

  // Va chiamata sempre dentro un tocco/clic dell'utente (o da un'azione di sistema):
  // audio.play() è la prima cosa che succede, prima di qualsiasi operazione asincrona
  function play() {
    const attempt = audio.play();
    started = true;
    unlock();
    // Il contesto audio può essere sospeso di nuovo (es. dopo una chiamata su iOS)
    if (actx && actx.state !== "running") actx.resume().catch(() => {});
    updateMini();
    if (attempt) {
      attempt.catch(err => {
        // Il browser ha bloccato la riproduzione: si chiede un tocco esplicito
        if (err && err.name === "NotAllowedError") showGate();
      });
    }
  }

  function pause() {
    silenceOther();
    audio.pause();
  }

  function toggle() {
    audio.paused ? play() : pause();
  }

  // Gli eventi contano solo se vengono dal piatto corrente
  const onDeck = (type, fn) => decks.forEach(d => d.addEventListener(type, e => {
    if (e.target === audio) fn(e);
  }));

  onDeck("play", () => {
    root.classList.add("is-playing");
    playBtns.forEach(b => b.setAttribute("aria-label", "Pausa"));
    if (actx && actx.state === "suspended") actx.resume();
    startViz();
  });
  onDeck("pause", () => {
    root.classList.remove("is-playing");
    playBtns.forEach(b => b.setAttribute("aria-label", "Riproduci"));
  });
  onDeck("loadedmetadata", () => {
    seeks.forEach(r => { r.max = audio.duration; });
    durs.forEach(el => { el.textContent = fmt(audio.duration); });
  });
  onDeck("timeupdate", () => {
    if (!seeking) showTime(audio.currentTime);
  });
  // In Repeat One il brano si ripete via audio.loop, quindi "ended" non scatta.
  // A fine brano il precedente è già in silenzio: il successivo parte senza dissolvenza.
  onDeck("ended", () => load(nextIndex(), true));
  onDeck("error", () => {
    $p(".pl-error").textContent = `Impossibile caricare "${PLAYLIST[index].title}".`;
    root.classList.remove("is-playing");
  });

  // ---------- Modalità: shuffle → all → one → shuffle ----------
  function shuffled(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildOrder(start) {
    order = [start, ...shuffled(PLAYLIST.map((_, i) => i).filter(i => i !== start))];
    pos = 0;
  }

  function nextIndex() {
    if (mode !== "shuffle") return index + 1;
    pos++;
    if (pos >= order.length) {
      // Nuovo giro, evitando di ripetere subito l'ultimo brano
      const last = order[order.length - 1];
      order = shuffled(PLAYLIST.map((_, i) => i));
      if (order[0] === last && order.length > 1) [order[0], order[1]] = [order[1], order[0]];
      pos = 0;
    }
    return order[pos];
  }

  function prevIndex() {
    if (mode !== "shuffle") return index - 1;
    if (pos > 0) pos--;
    return order[pos];
  }

  function setMode(m) {
    mode = m;
    audio.loop = m === "one";
    if (m === "shuffle") buildOrder(index);
    const btn = $p(".mode-btn");
    btn.dataset.mode = m;
    btn.setAttribute("aria-label", "Modalità: " + MODE_NAMES[m]);
    btn.title = MODE_NAMES[m];
    $p(".mode-label").textContent = MODE_NAMES[m];
    try { localStorage.setItem("djc-mode", m); } catch (e) {}
  }

  const goNext = () => load(nextIndex(), !audio.paused);
  const goPrev = () => {
    // Se il brano è avanzato, torna all'inizio; altrimenti brano precedente
    if (audio.currentTime > 3) audio.currentTime = 0;
    else load(prevIndex(), !audio.paused);
  };

  // ---------- Controlli ----------
  playBtns.forEach(b => b.addEventListener("click", toggle));
  $p(".pl-next").addEventListener("click", goNext);
  $p(".pl-prev").addEventListener("click", goPrev);
  $p(".mode-btn").addEventListener("click", () => {
    setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  });

  trackBtns.forEach((btn, i) => btn.addEventListener("click", () => {
    if (i === index) return toggle();
    if (mode === "shuffle") buildOrder(i);
    load(i, true);
  }));

  // Barre di avanzamento (lettore completo e compatto restano sincronizzate)
  seeks.forEach(r => {
    r.addEventListener("input", () => {
      seeking = true;
      showTime(parseFloat(r.value));
    });
    r.addEventListener("change", () => {
      audio.currentTime = parseFloat(r.value);
      seeking = false;
    });
  });

  // Volume (unico per entrambi i piatti)
  function updateVolume() {
    decks.forEach(applyVolume);
    const silent = muted || masterVol === 0;
    volBox.classList.toggle("muted", silent);
    $p(".pl-mute").setAttribute("aria-label", silent ? "Attiva audio" : "Disattiva audio");
    vol.style.opacity = muted ? 0.4 : 1;
    setFill(vol);
  }

  vol.addEventListener("input", () => {
    masterVol = parseFloat(vol.value);
    muted = false;
    updateVolume();
    try { localStorage.setItem("djc-volume", vol.value); } catch (e) {}
  });

  $p(".pl-mute").addEventListener("click", () => {
    if (masterVol === 0) {
      masterVol = vol.value = 0.5;
      muted = false;
    } else {
      muted = !muted;
    }
    updateVolume();
  });

  // Scorciatoie: spazio = play/pausa, Shift+frecce = brano precedente/successivo.
  // Attive solo se il lettore è visibile o la musica è già stata avviata.
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && sheetOpen) return closeSheet();
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (!started && !player.isConnected) return;
    if (e.code === "Space" && !e.target.closest("button, a")) {
      e.preventDefault();
      toggle();
    }
    if (e.shiftKey && e.key === "ArrowRight") goNext();
    if (e.shiftKey && e.key === "ArrowLeft") goPrev();
  });

  // Controlli di sistema (schermata di blocco, tasti multimediali)
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", play);
    navigator.mediaSession.setActionHandler("pause", pause);
    navigator.mediaSession.setActionHandler("nexttrack", goNext);
    navigator.mediaSession.setActionHandler("previoustrack", goPrev);
  }

  // ---------- Barra compatta e pannello espanso ----------
  const io = new IntersectionObserver(([entry]) => {
    playerVisible = entry.isIntersecting;
    updateMini();
  }, { threshold: 0.2 });

  const inSlot = () => !!player.closest("#player-slot");

  function updateMini() {
    const show = (started || inSlot()) && !(inSlot() && playerVisible) && !sheetOpen;
    mini.classList.toggle("show", show);
    document.body.classList.toggle("has-mini", show);
  }

  function expand() {
    if (inSlot()) player.scrollIntoView({ behavior: "smooth", block: "center" });
    else openSheet();
  }

  function openSheet() {
    loadDurations();
    sheet.querySelector(".sheet-body").appendChild(player);
    sheetOpen = true;
    sheet.classList.add("open");
    startViz();
    document.body.style.overflow = "hidden";
    updateMini();
    sheet.querySelector(".sheet-close").focus();
  }

  function closeSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    sheet.classList.remove("open");
    document.body.style.overflow = "";
    updateMini();
    $m(".mini-expand").focus({ preventScroll: true });
  }

  mini.addEventListener("click", e => {
    if (e.target.closest(".mini-play, .mini-seek")) return;
    expand();
  });
  sheet.querySelector(".sheet-close").addEventListener("click", closeSheet);
  sheet.querySelector(".sheet-backdrop").addEventListener("click", closeSheet);

  // Inserisce il lettore completo nello spazio della pagina, se presente
  function mount() {
    const slot = document.getElementById("player-slot");
    if (slot) {
      slot.appendChild(player);
      io.observe(player);
      loadDurations();
      startViz();
    } else {
      playerVisible = false;
    }
    updateMini();
  }

  // ---------- Navigazione senza ricaricare la pagina ----------
  // Con file:// i link funzionano normalmente (ma la musica si ferma).
  let currentPath = location.pathname;

  async function navigate(href, push) {
    let doc;
    try {
      const res = await fetch(href, { headers: { Accept: "text/html" } });
      if (!res.ok) throw new Error(res.status);
      doc = new DOMParser().parseFromString(await res.text(), "text/html");
    } catch (e) {
      location.href = href;
      return;
    }
    // Pagina che non usa il lettore: caricamento normale
    if (!doc.querySelector('script[src$="player.js"]')) {
      location.href = href;
      return;
    }

    closeSheet();
    io.unobserve(player);
    player.remove();
    pageCtrl.abort();
    pageCtrl = new AbortController();
    window.pageSignal = pageCtrl.signal;

    // Titolo, descrizione e stili della nuova pagina
    document.title = doc.title;
    const desc = doc.querySelector('meta[name="description"]');
    const curDesc = document.querySelector('meta[name="description"]');
    if (desc && curDesc) curDesc.content = desc.content;
    document.head.querySelectorAll("style").forEach(s => s.remove());
    doc.head.querySelectorAll("style").forEach(s => document.head.appendChild(s));

    // Contenuto: sostituisce tutto tranne gli elementi persistenti
    [...document.body.children].forEach(n => { if (!n.hasAttribute("data-persist")) n.remove(); });
    const scripts = [];
    [...doc.body.children].forEach(n => {
      if (n.tagName === "SCRIPT") {
        if (!n.src) scripts.push(n.textContent);
        return;
      }
      if (n.hasAttribute("data-persist")) return;
      document.body.insertBefore(n, sheet);
    });
    document.body.style.overflow = "";

    const url = new URL(href, location.href);
    if (push) history.pushState({}, "", url.href);
    currentPath = url.pathname;

    mount();

    // Esegue gli script della pagina (moduli: ognuno con il proprio scope)
    scripts.forEach(code => {
      const s = document.createElement("script");
      s.type = "module";
      s.textContent = code;
      document.body.appendChild(s);
    });

    const target = url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (target) target.scrollIntoView();
    else window.scrollTo({ top: 0, behavior: "instant" });
  }

  if (isHttp) {
    document.addEventListener("click", e => {
      const a = e.target.closest("a[href]");
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (!/(\.html|\/)$/.test(url.pathname)) return;
      // Ancora nella stessa pagina: lascia fare al browser
      if (url.pathname === location.pathname && url.hash) return;
      e.preventDefault();
      if (url.pathname === location.pathname) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      navigate(url.href, true);
    });

    window.addEventListener("popstate", () => {
      if (location.pathname === currentPath) return;
      navigate(location.href, false);
    });
  }

  // ---------- Avvio ----------
  let savedVol = 0.8;
  try {
    const v = parseFloat(localStorage.getItem("djc-volume"));
    if (!isNaN(v)) savedVol = v;
  } catch (e) {}
  // Senza barra il lettore resta al massimo: decidono i tasti del dispositivo
  if (volumeHidden) savedVol = 1;
  masterVol = vol.value = savedVol;
  updateVolume();

  load(0, false);

  let savedMode = "all";
  try {
    const m = localStorage.getItem("djc-mode");
    if (MODES.includes(m)) savedMode = m;
  } catch (e) {}
  setMode(savedMode);

  mount();

  // Su mobile, al primo caricamento della sessione, chiede il tocco che sblocca l'audio
  let seenGate = false;
  try { seenGate = sessionStorage.getItem("djc-unlocked") === "1"; } catch (e) {}
  if (isTouch && !seenGate) showGate();

  window.djPlayer = { play, pause, toggle, expand, next: goNext };
})();
