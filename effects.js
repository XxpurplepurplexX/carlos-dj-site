/* =========================================================
   Effetti condivisi — DJ Carlos

   - Schermata di caricamento: al primo caricamento della sessione mostra
     il logo al neon con una barra viola → rosa, poi svanisce quando la
     pagina (stili, immagini e font) è pronta.
   - Comparsa allo scroll (Intersection Observer):
       data-reveal   l'elemento appare quando entra nello schermo
       data-stagger  i figli appaiono uno alla volta (es. schede concerti)
     Un MutationObserver rileva i contenuti aggiunti dopo (concerti generati
     via JS, pagine caricate da player.js senza ricaricare il browser).

   Va incluso nel <head> (non defer) per nascondere la pagina prima
   che venga disegnata.
   ========================================================= */
(() => {
  if (window.djEffects) return;

  const html = document.documentElement;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Schermata di caricamento ----------
  let showLoader = false;
  try {
    showLoader = sessionStorage.getItem("djc-loaded") !== "1";
    sessionStorage.setItem("djc-loaded", "1");
  } catch (e) {}

  if (!reduceMotion) html.classList.add("fx");

  const MIN_TIME = 1400;  // il logo resta visibile almeno così (ms)
  const MAX_TIME = 6000;  // dopo questo tempo il caricamento si chiude comunque

  let loaderDone = !showLoader;
  let onLoaderDone = () => {};

  if (showLoader) {
    html.classList.add("is-loading");
    const start = performance.now();
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const pageLoaded = new Promise(r => {
      if (document.readyState === "complete") r();
      else window.addEventListener("load", r, { once: true });
    });
    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();

    document.addEventListener("DOMContentLoaded", () => {
      const loader = document.createElement("div");
      loader.className = "page-loader";
      loader.setAttribute("role", "status");
      loader.setAttribute("aria-label", "Caricamento in corso");
      loader.innerHTML = `
        <div class="loader-logo" aria-hidden="true">DJ <span>CARLOS</span></div>
        <div class="loader-bar" aria-hidden="true"><span></span></div>`;
      document.body.prepend(loader);

      const logo = loader.querySelector(".loader-logo");
      const fill = loader.querySelector(".loader-bar span");

      // Accende il logo quando il font al neon è disponibile
      const fontLoad = document.fonts ? document.fonts.load("1em Monoton") : Promise.resolve();
      Promise.race([fontLoad, wait(1200)]).then(() => logo.classList.add("ready"));

      // Avanzamento simulato: si avvicina al 90% finché la pagina non è pronta
      let p = 0, ready = false;
      const tick = () => {
        if (ready) return;
        p += (0.9 - p) * 0.035;
        fill.style.setProperty("--p", p.toFixed(3));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      Promise.race([
        Promise.all([pageLoaded, fontsReady, wait(MIN_TIME - (performance.now() - start))]),
        wait(MAX_TIME)
      ]).then(async () => {
        ready = true;
        fill.style.setProperty("--p", "1");
        await wait(reduceMotion ? 0 : 350);
        html.classList.remove("is-loading");
        loader.classList.add("hide");
        loaderDone = true;
        onLoaderDone();
        await wait(reduceMotion ? 0 : 650);
        loader.remove();
      });
    });
  }

  // ---------- Comparsa allo scroll ----------
  if (reduceMotion || !("IntersectionObserver" in window)) {
    html.classList.remove("fx");
    window.djEffects = {};
    return;
  }

  const STAGGER_STEP = 140;        // ms tra un elemento e il successivo
  const lastStart = new WeakMap(); // contenitore → istante dell'ultima comparsa

  function reveal(el, delay) {
    io.unobserve(el);
    el.style.animationDelay = delay + "ms";
    el.classList.add("revealing");
    el.addEventListener("animationend", function done(e) {
      if (e.target !== el || e.animationName !== "reveal-in") return;
      el.removeEventListener("animationend", done);
      el.classList.replace("revealing", "revealed");
      el.style.animationDelay = "";
    });
  }

  const io = new IntersectionObserver(entries => {
    const now = performance.now();
    entries
      .filter(e => e.isIntersecting)
      .map(e => e.target)
      // Ordine del documento, così gli elementi di un gruppo appaiono in sequenza
      .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      .forEach(el => {
        const group = el.parentElement && el.parentElement.hasAttribute("data-stagger") ? el.parentElement : null;
        if (!group) return reveal(el, 0);
        const prev = lastStart.get(group);
        const at = prev === undefined ? now : Math.max(now, prev + STAGGER_STEP);
        lastStart.set(group, at);
        reveal(el, Math.round(at - now));
      });
  }, { threshold: 0.15 });

  function scan(root) {
    if (!(root instanceof Element)) return;
    const found = [...root.querySelectorAll("[data-reveal], [data-stagger] > *")];
    if (root.matches("[data-reveal]") || (root.parentElement && root.parentElement.matches("[data-stagger]"))) {
      found.push(root);
    }
    found.forEach(el => {
      if (el.dataset.fxSeen || el.tagName === "SCRIPT") return;
      el.dataset.fxSeen = "1";
      io.observe(el);
    });
  }

  function start() {
    scan(document.body);
    new MutationObserver(list => {
      list.forEach(m => m.addedNodes.forEach(scan));
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Con la schermata di caricamento, le animazioni partono quando svanisce
  document.addEventListener("DOMContentLoaded", () => {
    if (loaderDone) start();
    else onLoaderDone = start;
  });

  window.djEffects = { scan };
})();
