/* ============================================================
   Glückslos · game.js · Rubbellose wie an der Tankstelle
   ------------------------------------------------------------
   SO FUNKTIONIERT DIESES SPIEL
   1. Fünf Lose mit eigenem Preis und eigener Gewinntabelle:
        Dreierglück (10)      3 gleiche Beträge gewinnen
        Glückszahlen (20)     eigene Zahl = Gewinnzahl, ×2-Feld verdoppelt
        Glücksklee (25)       3 gleiche Symbole in einem Spiel
        Schlag die Bank (30)  eigene Zahl höher als die Bankzahl
        Goldmine (50)         Gold × Multiplikator
   2. Beim KAUF steht das Ergebnis fest (losZiehen in lose.js, echter
      Zufall aus crypto.getRandomValues). Das Rubbeln deckt nur auf.
   3. GELD: einsatzAbbuchen(preis) beim Kauf. Gutgeschrieben wird, wenn
      alles aufgedeckt ist: rundeAbschliessen(preis, gewinn). Das offene
      Los liegt in localStorage (ba:rubbellos:offen). Wer die Seite
      verlässt, bekommt den Gewinn trotzdem ("pagehide" bucht sofort),
      nach dem Neuladen geht das Rubbeln einfach weiter.
   4. RUBBELN: Über jedem Feld liegt ein <canvas> mit der silbernen
      Rubbelschicht. Jede Bewegung radiert mit globalCompositeOperation
      "destination-out" ein Stück weg. Ist gut die Hälfte frei, fällt der
      Rest von allein. Tastatur: Feld fokussieren und Enter/Leertaste.
      "Alles aufdecken" deckt den Rest auf einmal auf.
   5. Topliste: höchster Netto-Gewinn eines Loses (Gewinn minus Preis).
   ============================================================ */

import { toplisteAnzeigen, stillEintragen, bewegungReduziert } from "./assets/ui.js";
import { lade, speichere, entferne } from "./assets/storage.js";
import {
  STARTGELD,
  kontostand,
  einsatzAbbuchen,
  rundeAbschliessen,
  istPleite,
  pleiteNeustart,
  walletHud,
  walletHudAktualisieren,
} from "./assets/wallet.js";
import { tonKnopf, klangGewinn, klangKartenFlip } from "./assets/klang.js";
import { gewinnFeiern, stufeBestimmen } from "./assets/gewinnfeier.js";
import { MOTIV, FOLIE, fussBauen } from "./design.js?v=20261024";
import {
  VARIANTEN,
  variante,
  losZiehen,
  rtpExakt,
  gewinnChance,
  gewinnplan,
  GUENSTIGSTES_LOS,
} from "./lose.js";

const SPIEL = "rubbellos";
const FREI_SCHWELLE = 0.5; // ab diesem freigerubbelten Anteil fällt die Schicht
const PINSEL = 15; // Radius des "Fingers" in CSS-Pixeln

const geld = (n) => n.toLocaleString("de-DE");

/* ------------------------------------------------------------
   SYMBOLE (eigene Inline-SVGs, keine Fremdgrafiken)
   ------------------------------------------------------------ */

const SYMBOL_PFADE = {
  klee: '<g fill="#5ee06a"><circle cx="16" cy="10" r="6"/><circle cx="22" cy="16" r="6"/><circle cx="16" cy="22" r="6"/><circle cx="10" cy="16" r="6"/></g><path d="M16 17 Q19 25 23 29" stroke="#3a9a44" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
  hufeisen:
    '<path d="M8 6 V16 a8 8 0 0 0 16 0 V6" fill="none" stroke="#c6cbe0" stroke-width="5" stroke-linecap="round"/><g fill="#6b7090"><circle cx="8" cy="12" r="1.3"/><circle cx="24" cy="12" r="1.3"/><circle cx="10" cy="20" r="1.3"/><circle cx="22" cy="20" r="1.3"/></g>',
  stern:
    '<path d="M16 3 L19.8 11.6 L29 12.4 L22 18.6 L24.2 27.8 L16 23 L7.8 27.8 L10 18.6 L3 12.4 L12.2 11.6 Z" fill="#ffd34d"/>',
  herz: '<path d="M16 28 C4 19 3 12 7 8 C10.5 4.5 15 6.5 16 10 C17 6.5 21.5 4.5 25 8 C29 12 28 19 16 28 Z" fill="#ff4f7d"/>',
  glocke:
    '<path d="M16 4 C10 4 8 9 8 15 V20 L5 24 H27 L24 20 V15 C24 9 22 4 16 4 Z" fill="#ffb347"/><circle cx="16" cy="27" r="3" fill="#d9862a"/>',
  muenze:
    '<circle cx="16" cy="16" r="12" fill="#e8b830"/><circle cx="16" cy="16" r="9" fill="none" stroke="#b88a14" stroke-width="1.5"/><text x="16" y="21" text-anchor="middle" font-size="13" font-weight="700" fill="#8a6408" font-family="sans-serif">€</text>',
};
const SYMBOL_NAMEN = {
  klee: "Kleeblatt",
  hufeisen: "Hufeisen",
  stern: "Stern",
  herz: "Herz",
  glocke: "Glocke",
  muenze: "Münze",
};

function symbolSvg(name) {
  return `<svg viewBox="0 0 32 32" class="symbol" aria-hidden="true">${SYMBOL_PFADE[name]}</svg>`;
}

/* ------------------------------------------------------------
   DIE KARTEN-BILDER: je Variante eine Funktion, die die Felder baut.
   Jedes Feld: { el, inhalt (HTML), text (für Screenreader), trifft(offen) }
   trifft() sagt, ob das Feld (aufgedeckt) zu einem Gewinn gehört –
   nur für die Hervorhebung, gerechnet wird in lose.js.
   ------------------------------------------------------------ */

const BILDER = {
  dreier(karte) {
    const felder = karte.felder.map((b, i) => ({
      klasse: "rf-betrag",
      inhalt: `<span class="rf-zahl">${geld(b)}</span>`,
      text: `${geld(b)}`,
      trifft: (offen) =>
        karte.felder.filter((x, j) => x === b && offen.has(j)).length >= 3 && offen.has(i),
    }));
    return { gruppen: [{ titel: "Finde 3 gleiche Beträge", klasse: "raster-3", felder }] };
  },

  zahlen(karte) {
    const gz = karte.gewinnzahlen;
    const gewinnFelder = gz.map((z) => ({
      klasse: "rf-gewinnzahl",
      inhalt: `<span class="rf-zahl">${z}</span>`,
      text: `Gewinnzahl ${z}`,
      trifft: () => false,
    }));
    const eigene = karte.eigene.map((e) => ({
      klasse: "rf-eigen",
      inhalt: `<span class="rf-zahl">${e.zahl}</span><span class="rf-klein">${geld(e.betrag)}</span>`,
      text: `Zahl ${e.zahl}, Betrag ${geld(e.betrag)}`,
      trifft: (offen, idx) => {
        const gi = gz.indexOf(e.zahl);
        return gi >= 0 && offen.has(gi); // die passende Gewinnzahl ist schon frei
      },
    }));
    const bonus = {
      klasse: "rf-bonus",
      inhalt:
        karte.bonus === "x2"
          ? '<span class="rf-zahl">×2</span>'
          : '<span class="rf-klein">kein Bonus</span>',
      text: karte.bonus === "x2" ? "Bonus: Gewinn verdoppelt" : "kein Bonus",
      trifft: () => karte.bonus === "x2" && karte.eigene.some((e) => gz.includes(e.zahl)),
    };
    return {
      gruppen: [
        { titel: "Gewinnzahlen", klasse: "raster-2", felder: gewinnFelder },
        { titel: "Deine Zahlen", klasse: "raster-5", felder: eigene },
        { titel: "Bonus ×2", klasse: "raster-1", felder: [bonus] },
      ],
    };
  },

  klee(karte) {
    const felder = karte.spiele.map((sp, i) => ({
      klasse: "rf-spiel",
      inhalt: `<span class="rf-nr">Spiel ${i + 1}</span><span class="rf-symbole">${sp.symbole.map(symbolSvg).join("")}</span><span class="rf-zahl">${geld(sp.betrag)}</span>`,
      text: `Spiel ${i + 1}: ${sp.symbole.map((s) => SYMBOL_NAMEN[s]).join(", ")}, Betrag ${geld(sp.betrag)}`,
      trifft: () => sp.symbole.every((s) => s === sp.symbole[0]),
    }));
    return {
      gruppen: [{ titel: "3 gleiche Symbole in einem Spiel gewinnen", klasse: "raster-2", felder }],
    };
  },

  bank(karte) {
    const bank = {
      klasse: "rf-gewinnzahl",
      inhalt: `<span class="rf-zahl">${karte.bank}</span>`,
      text: `Bankzahl ${karte.bank}`,
      trifft: () => false,
    };
    const eigene = karte.eigene.map((e) => ({
      klasse: "rf-eigen",
      inhalt: `<span class="rf-zahl">${e.zahl}</span><span class="rf-klein">${geld(e.betrag)}</span>`,
      text: `Zahl ${e.zahl}, Betrag ${geld(e.betrag)}`,
      trifft: (offen) => offen.has(0) && e.zahl > karte.bank,
    }));
    return {
      gruppen: [
        { titel: "Bankzahl", klasse: "raster-1", felder: [bank] },
        { titel: "Deine Zahlen: höher als die Bank gewinnt", klasse: "raster-3", felder: eigene },
      ],
    };
  },

  gold(karte) {
    // Felder abwechselnd Fund / Multiplikator, Stollen für Stollen (Index 2i und 2i+1)
    const felder = karte.stollen.flatMap((st, i) => [
      {
        klasse: st.gold ? "rf-fund" : "rf-fund rf-geroell",
        inhalt: st.gold
          ? `<span class="rf-klein">Gold</span><span class="rf-zahl">${geld(st.gold)}</span>`
          : '<span class="rf-klein">Geröll</span>',
        text: st.gold ? `Stollen ${i + 1}: Gold ${geld(st.gold)}` : `Stollen ${i + 1}: Geröll`,
        trifft: (offen) => st.gold > 0 && offen.has(2 * i) && offen.has(2 * i + 1),
      },
      {
        klasse: "rf-multi",
        inhalt: `<span class="rf-zahl">×${st.multi}</span>`,
        text: `Stollen ${i + 1}: Multiplikator ${st.multi}`,
        trifft: (offen) => st.gold > 0 && offen.has(2 * i) && offen.has(2 * i + 1),
      },
    ]);
    return {
      gruppen: [
        { titel: "Stollen 1 · 2 · 3: Gold × Multiplikator", klasse: "raster-stollen", felder },
      ],
    };
  },
};

/** Leeres Muster-Los (vor dem Kauf): dieselbe Form, aber ohne Inhalt. */
function musterKarte(id) {
  const leer = {
    dreier: { felder: Array(9).fill(0) },
    zahlen: { gewinnzahlen: [0, 0], eigene: Array(10).fill({ zahl: 0, betrag: 0 }), bonus: "leer" },
    klee: { spiele: Array(6).fill({ symbole: ["klee", "stern", "herz"], betrag: 0 }) },
    bank: { bank: 0, eigene: Array(6).fill({ zahl: 0, betrag: 0 }) },
    gold: { stollen: Array(3).fill({ gold: 0, multi: 1 }) },
  };
  return { variante: id, muster: true, ...leer[id] };
}

/* ------------------------------------------------------------
   DIE RUBBELSCHICHT
   ------------------------------------------------------------ */

/** Malt die silberne Schicht (mit feinem Glitzer und Fragezeichen) auf das Canvas. */
function deckeMalen(canvas, akzent, id) {
  const [stopps, hell, dunkel] = FOLIE[id] || FOLIE.dreier;
  const ctx = canvas.getContext("2d");
  const { width: b, height: h } = canvas;
  const verlauf = ctx.createLinearGradient(0, 0, b, h);
  [0, 0.45, 0.55, 1].forEach((p, i) => verlauf.addColorStop(p, stopps[i]));
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = verlauf;
  ctx.fillRect(0, 0, b, h);
  // Glitzer: viele winzige helle und dunkle Punkte (Math.random reicht für Deko)
  for (let i = 0; i < (b * h) / 90; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? hell : dunkel;
    ctx.fillRect(Math.random() * b, Math.random() * h, 1.5, 1.5);
  }
  ctx.fillStyle = akzent;
  ctx.globalAlpha = 0.55;
  ctx.font = `700 ${Math.round(Math.min(b, h) * 0.42)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", b / 2, h / 2);
  ctx.globalAlpha = 1;
}

/** Anteil der freigerubbelten Pixel (Stichprobe jedes 6. Pixels in beide Richtungen). */
function freiAnteil(canvas) {
  const { width: b, height: h } = canvas;
  const daten = canvas.getContext("2d").getImageData(0, 0, b, h).data;
  let frei = 0;
  let gesamt = 0;
  for (let y = 0; y < h; y += 6)
    for (let x = 0; x < b; x += 6) {
      gesamt++;
      if (daten[(y * b + x) * 4 + 3] < 40) frei++;
    }
  return gesamt ? frei / gesamt : 1;
}

/* ============================================================
   DAS SPIEL IM BROWSER
   ============================================================ */

function starteSpiel() {
  const wahlElement = document.getElementById("los-wahl");
  const losElement = document.getElementById("los");
  const kaufKnopf = document.getElementById("kaufen");
  const allesKnopf = document.getElementById("alles");
  const meldungElement = document.getElementById("meldung");
  const gewinnElement = document.getElementById("gewinn");
  const hudLetzter = document.getElementById("hud-letzter");
  const planElement = document.getElementById("gewinnplan");
  const planInfo = document.getElementById("gewinnplan-info");
  const toplisteElement = document.getElementById("topliste");
  const resetKnopf = document.getElementById("reset");
  const buehne = document.getElementById("buehne");

  let gewaehlt = variante(lade(SPIEL, "variante", "dreier"))
    ? lade(SPIEL, "variante", "dreier")
    : "dreier";
  let offen = null; // { karte, offen: [Feldindizes], gebucht } – das gekaufte, noch nicht fertige Los
  let felder = []; // [{ el, decke, daten, offen }]
  let fertigGemeldet = false;

  /* ---------- Anzeigen ---------- */

  function meldungSetzen(text, art = "neutral") {
    meldungElement.textContent = text;
    meldungElement.dataset.art = art;
  }

  function gewinnSetzen(netto) {
    gewinnElement.className = "gewinn-anzeige";
    if (netto === null) gewinnElement.textContent = "";
    else if (netto > 0) {
      gewinnElement.textContent = `+${geld(netto)}`;
      gewinnElement.classList.add("plus");
    } else if (netto < 0) {
      gewinnElement.textContent = `−${geld(-netto)}`;
      gewinnElement.classList.add("minus");
    } else gewinnElement.textContent = "±0";
  }

  function steuerungAktualisieren() {
    const laeuft = offen !== null;
    const stand = kontostand();
    for (const knopf of wahlElement.querySelectorAll("button")) {
      const v = variante(knopf.dataset.id);
      knopf.setAttribute("aria-pressed", String(v.id === gewaehlt));
      knopf.disabled = laeuft || v.preis > stand;
    }
    const v = variante(gewaehlt);
    kaufKnopf.hidden = laeuft;
    kaufKnopf.disabled = v.preis > stand;
    kaufKnopf.textContent = `LOS KAUFEN · ${geld(v.preis)}`;
    allesKnopf.hidden = !laeuft;
    resetKnopf.disabled = laeuft;
    document.body.style.setProperty("--ak", `var(--${FARBE[gewaehlt]})`);
  }

  function toplisteZeigen() {
    toplisteAnzeigen(toplisteElement, SPIEL, (p) => `+${geld(p)}`);
  }

  /** Gewinnplan der gewählten Variante: Betrag und Chance "1 zu N". */
  function gewinnplanZeigen() {
    const v = variante(gewaehlt);
    planElement.replaceChildren(
      ...gewinnplan(v).map(({ gewinn, einsZu }) => {
        const tr = document.createElement("tr");
        const a = document.createElement("td");
        a.textContent = geld(gewinn);
        const b = document.createElement("td");
        b.textContent = `1 zu ${einsZu.toLocaleString("de-DE", { maximumFractionDigits: einsZu < 10 ? 1 : 0 })}`;
        tr.append(a, b);
        return tr;
      }),
    );
    planInfo.textContent =
      `${v.name}, Preis ${geld(v.preis)}: Gewinnchance ${prozent(gewinnChance(v))}, ` +
      `Auszahlungsquote ${prozent(rtpExakt(v))}.`;
  }

  /* ---------- Das Los bauen ---------- */

  function losBauen(karte, aufgedeckt = new Set()) {
    const bildDaten = BILDER[karte.variante](karte);
    const v = variante(karte.variante);
    losElement.className = `los los-${v.id}${karte.muster ? " los-muster" : ""}`;
    losElement.replaceChildren();

    const kopf = document.createElement("div");
    kopf.className = "los-kopf";
    kopf.innerHTML = '<span class="los-name"></span><span class="los-preis"></span>';
    kopf.querySelector(".los-name").textContent = v.name.toUpperCase();
    kopf.querySelector(".los-preis").textContent = `${geld(v.preis)}`;
    const motiv = document.createElement("span");
    motiv.className = "los-motiv";
    motiv.innerHTML = MOTIV[v.id] || ""; // feste SVGs aus design.js
    kopf.append(motiv);
    losElement.append(kopf);

    felder = [];
    for (const gruppe of bildDaten.gruppen) {
      const titel = document.createElement("p");
      titel.className = "los-titel";
      titel.textContent = gruppe.titel;
      const raster = document.createElement("div");
      raster.className = `los-raster ${gruppe.klasse}`;
      for (const daten of gruppe.felder) {
        const index = felder.length;
        const el = document.createElement("div");
        el.className = `rf ${daten.klasse}`;
        const inhalt = document.createElement("div");
        inhalt.className = "rf-inhalt";
        if (!karte.muster) inhalt.innerHTML = daten.inhalt; // nur feste Texte und Zahlen aus lose.js
        const feld = {
          el,
          inhalt,
          daten,
          offen: aufgedeckt.has(index),
          decke: null,
          zuege: 0,
          letzter: null,
        };
        el.append(inhalt);
        if (!feld.offen) {
          const decke = document.createElement("canvas");
          decke.className = "rf-decke";
          decke.setAttribute("aria-hidden", "true");
          el.append(decke);
          feld.decke = decke;
          inhalt.setAttribute("aria-hidden", "true");
          if (!karte.muster) {
            el.tabIndex = 0;
            el.setAttribute("role", "button");
            el.setAttribute("aria-label", `Feld ${index + 1} freirubbeln`);
          }
        } else {
          el.setAttribute("aria-label", daten.text);
        }
        raster.append(el);
        felder.push(feld);
      }
      losElement.append(titel, raster);
    }
    if (!karte.muster) losElement.append(fussBauen(karte, prozent(rtpExakt(v))));
    // Schichten malen, sobald die Felder ihre Größe haben
    requestAnimationFrame(() => {
      const akzent = getComputedStyle(document.body).getPropertyValue("--ak").trim() || "#ffc84d";
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const f of felder) {
        if (!f.decke) continue;
        const r = f.el.getBoundingClientRect();
        f.decke.width = Math.max(1, Math.round(r.width * dpr));
        f.decke.height = Math.max(1, Math.round(r.height * dpr));
        deckeMalen(f.decke, akzent, karte.variante);
      }
    });
    trefferMarkieren();
  }

  function aufgedeckteMenge() {
    return new Set(felder.map((f, i) => (f.offen ? i : -1)).filter((i) => i >= 0));
  }

  function trefferMarkieren() {
    const menge = aufgedeckteMenge();
    felder.forEach((f, i) => f.el.classList.toggle("treffer", f.offen && f.daten.trifft(menge, i)));
  }

  /* ---------- Aufdecken ---------- */

  function feldAufdecken(feld, still = false) {
    if (feld.offen || !offen) return;
    feld.offen = true;
    const index = felder.indexOf(feld);
    offen.offen.push(index);
    speichere(SPIEL, "offen", offen);
    feld.el.removeAttribute("tabindex");
    feld.el.removeAttribute("role");
    feld.el.setAttribute("aria-label", feld.daten.text);
    feld.inhalt.removeAttribute("aria-hidden");
    if (feld.decke) {
      const decke = feld.decke;
      feld.decke = null;
      if (bewegungReduziert()) decke.remove();
      else {
        decke.classList.add("weg");
        setTimeout(() => decke.remove(), 350);
      }
    }
    if (!still) klangKartenFlip();
    trefferMarkieren();
    if (felder.every((f) => f.offen)) losFertig();
  }

  /** "Alles aufdecken": die restlichen Felder nacheinander (bei reduzierter Bewegung sofort). */
  function allesAufdecken() {
    if (!offen) return;
    allesKnopf.disabled = true;
    const rest = felder.filter((f) => !f.offen);
    if (bewegungReduziert()) {
      rest.forEach((f) => feldAufdecken(f, true));
      klangKartenFlip();
      return;
    }
    rest.forEach((f, i) => setTimeout(() => feldAufdecken(f, i % 2 === 1), i * 90));
  }

  /* ---------- Rubbeln mit Maus / Finger / Stift ---------- */

  function feldUnter(x, y) {
    const el = document.elementFromPoint(x, y)?.closest(".rf");
    return felder.find((f) => f.el === el && !f.offen && f.decke) ?? null;
  }

  function rubbeln(feld, x, y) {
    const decke = feld.decke;
    const r = decke.getBoundingClientRect();
    const sx = decke.width / r.width;
    const px = (x - r.left) * sx;
    const py = (y - r.top) * sx;
    const ctx = decke.getContext("2d");
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = PINSEL * 2 * sx;
    ctx.beginPath();
    const von = feld.letzter ?? [px, py];
    ctx.moveTo(von[0], von[1]);
    ctx.lineTo(px + 0.01, py);
    ctx.stroke();
    feld.letzter = [px, py];
    if (++feld.zuege % 6 === 0 && freiAnteil(decke) >= FREI_SCHWELLE) feldAufdecken(feld);
  }

  let aktivesFeld = null;
  let rubbelt = false;
  losElement.addEventListener("pointerdown", (e) => {
    if (!offen) return;
    const feld = feldUnter(e.clientX, e.clientY);
    if (!feld) return;
    e.preventDefault();
    rubbelt = true;
    losElement.setPointerCapture?.(e.pointerId);
    aktivesFeld = feld;
    feld.letzter = null;
    rubbeln(feld, e.clientX, e.clientY);
  });
  losElement.addEventListener("pointermove", (e) => {
    if (!rubbelt || !offen) return;
    // ein Strich darf über mehrere Felder laufen
    const teilschritte = e.getCoalescedEvents?.() ?? [];
    for (const p of teilschritte.length ? teilschritte : [e]) {
      const feld = feldUnter(p.clientX, p.clientY);
      if (feld !== aktivesFeld) {
        if (aktivesFeld) aktivesFeld.letzter = null;
        aktivesFeld = feld;
      }
      if (feld) rubbeln(feld, p.clientX, p.clientY);
    }
  });
  const rubbelEnde = () => {
    rubbelt = false;
    if (aktivesFeld?.decke && freiAnteil(aktivesFeld.decke) >= FREI_SCHWELLE)
      feldAufdecken(aktivesFeld);
    aktivesFeld = null;
  };
  losElement.addEventListener("pointerup", rubbelEnde);
  losElement.addEventListener("pointercancel", rubbelEnde);
  losElement.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const feld = felder.find((f) => f.el === e.target);
    if (!feld || feld.offen) return;
    e.preventDefault();
    const naechstes = felder.slice(felder.indexOf(feld) + 1).find((f) => !f.offen);
    feldAufdecken(feld);
    naechstes?.el.focus(); // Fokus wandert zum nächsten verdeckten Feld
  });

  /* ---------- Geld ---------- */

  /** Bucht den Gewinn des offenen Loses (genau einmal) und trägt die Topliste ein. */
  function abrechnen() {
    if (!offen || offen.gebucht) return;
    offen.gebucht = true;
    const { preis, gewinn } = offen.karte;
    rundeAbschliessen(preis, gewinn);
    if (gewinn - preis > 0) stillEintragen(SPIEL, gewinn - preis);
    speichere(SPIEL, "offen", offen);
  }
  // Seite wird verlassen: Gewinn sofort gutschreiben, das Los bleibt zum Weiterrubbeln liegen
  window.addEventListener("pagehide", abrechnen);

  function kaufen() {
    if (offen) return;
    const v = variante(gewaehlt);
    if (!einsatzAbbuchen(v.preis)) {
      meldungSetzen("Dafür reicht dein Spielgeld nicht. Nimm ein günstigeres Los.", "falsch");
      steuerungAktualisieren();
      return;
    }
    offen = { karte: losZiehen(v.id), offen: [], gebucht: false };
    speichere(SPIEL, "offen", offen);
    fertigGemeldet = false;
    walletHudAktualisieren();
    gewinnSetzen(null);
    losBauen(offen.karte);
    allesKnopf.disabled = false;
    steuerungAktualisieren();
    meldungSetzen("Rubbel los! Mit Maus oder Finger über die silbernen Felder.");
    felder[0]?.el.focus({ preventScroll: true });
  }

  async function losFertig() {
    if (!offen || fertigGemeldet) return;
    fertigGemeldet = true;
    const { preis, gewinn } = offen.karte;
    abrechnen();
    entferne(SPIEL, "offen");
    offen = null;
    walletHudAktualisieren();
    const netto = gewinn - preis;
    gewinnSetzen(netto);
    hudLetzter.textContent = netto > 0 ? `+${geld(netto)}` : netto < 0 ? `−${geld(-netto)}` : "±0";
    hudLetzter.className = `wert ${netto > 0 ? "plus" : netto < 0 ? "minus" : ""}`;
    toplisteZeigen();
    losElement.classList.add(gewinn ? "los-gewonnen" : "los-niete");
    if (gewinn > preis) meldungSetzen(`Gewonnen: ${geld(gewinn)}!`, "richtig");
    else if (gewinn === preis)
      meldungSetzen(`Gewonnen: ${geld(gewinn)}, dein Einsatz ist zurück.`, "richtig");
    else meldungSetzen("Leider eine Niete. Das nächste Los vielleicht?", "falsch");
    steuerungAktualisieren();
    kaufKnopf.textContent = `NOCH EIN LOS · ${geld(variante(gewaehlt).preis)}`;
    if (gewinn > 0) {
      klangGewinn(stufeBestimmen(gewinn, preis));
      await gewinnFeiern({ buehne, betrag: gewinn, einsatz: preis });
    }
    if (istPleite(GUENSTIGSTES_LOS)) pleiteDialogZeigen();
  }

  /* ---------- Variante wählen ---------- */

  function waehlen(id) {
    if (offen || !variante(id)) return;
    gewaehlt = id;
    speichere(SPIEL, "variante", id);
    steuerungAktualisieren();
    losBauen(musterKarte(id));
    gewinnplanZeigen();
    gewinnSetzen(null);
    meldungSetzen(`${variante(id).name}: ${variante(id).kurz}.`);
  }

  for (const v of VARIANTEN) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = `los-wahl-knopf wahl-${v.id}`;
    knopf.dataset.id = v.id;
    knopf.innerHTML = '<span class="lw-name"></span><span class="lw-preis"></span>';
    knopf.querySelector(".lw-name").textContent = v.name;
    knopf.querySelector(".lw-preis").textContent = geld(v.preis);
    knopf.addEventListener("click", () => waehlen(v.id));
    wahlElement.append(knopf);
  }

  /* ---------- Pleite ---------- */

  function pleiteDialogZeigen() {
    if (document.getElementById("pleite-dialog")) return;
    const dialog = document.createElement("dialog");
    dialog.className = "spiel-dialog";
    dialog.id = "pleite-dialog";
    dialog.innerHTML = `
      <h2>Pleite!</h2>
      <p>Dein Spielgeld reicht für kein Los mehr. Du bekommst neues Startgeld:</p>
      <p class="gross"></p>
      <div class="aktionen">
        <button class="knopf primaer" data-rolle="neu">Neues Startgeld</button>
        
      </div>`;
    dialog.querySelector(".gross").textContent = geld(STARTGELD);
    dialog.querySelector('[data-rolle="neu"]').addEventListener("click", () => {
      pleiteNeustart();
      walletHudAktualisieren();
      dialog.close();
      dialog.remove();
      steuerungAktualisieren();
      meldungSetzen("Neues Startgeld ist da. Viel Glück!");
    });
    dialog.addEventListener("cancel", (e) => e.preventDefault());
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("button")?.focus();
  }

  /* ---------- Start ---------- */

  kaufKnopf.addEventListener("click", kaufen);
  allesKnopf.addEventListener("click", allesAufdecken);
  resetKnopf.addEventListener("click", () => {
    if (offen) return;
    entferne(SPIEL, "topliste");
    toplisteZeigen();
  });

  walletHud(document.getElementById("wallet-hud"));
  tonKnopf(document.querySelector(".spiel-kopf"));
  fairnessTabelle();

  // Ein offenes Los vom letzten Besuch? Dann geht es dort weiter.
  const gespeichert = lade(SPIEL, "offen", null);
  if (
    gespeichert?.karte &&
    variante(gespeichert.karte.variante) &&
    Array.isArray(gespeichert.offen)
  ) {
    offen = gespeichert;
    gewaehlt = offen.karte.variante;
    steuerungAktualisieren();
    losBauen(offen.karte, new Set(offen.offen));
    gewinnplanZeigen();
    meldungSetzen("Dein angefangenes Los liegt noch da. Rubbel weiter!");
    if (felder.every((f) => f.offen)) losFertig();
  } else {
    waehlen(gewaehlt);
    if (istPleite(GUENSTIGSTES_LOS)) pleiteDialogZeigen();
  }
  toplisteZeigen();
}

const FARBE = { dreier: "violet", zahlen: "cyan", klee: "lime", bank: "pink", gold: "gold" };

function prozent(anteil) {
  return `${(anteil * 100).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** Lernbox: alle Lose im Vergleich, direkt aus den Tabellen in lose.js berechnet. */
function fairnessTabelle() {
  const tbody = document.getElementById("fair-tabelle");
  if (!tbody) return;
  tbody.replaceChildren(
    ...VARIANTEN.map((v) => {
      const tr = document.createElement("tr");
      const plan = gewinnplan(v);
      for (const text of [
        v.name,
        geld(v.preis),
        prozent(gewinnChance(v)),
        prozent(rtpExakt(v)),
        `${geld(plan[0].gewinn)} (1 zu ${geld(Math.round(plan[0].einsZu))})`,
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }),
  );
}

if (typeof document !== "undefined") starteSpiel();
