/* ============================================================
   Glückslos · lose.js · die reine Logik der Rubbellose
   ------------------------------------------------------------
   Kein DOM, kein Speicher: alles hier läuft auch in Node und wird
   dort getestet (exakte Auszahlungsquote, Simulation, Aufbau-Prüfung).

   SO ENTSTEHT EIN LOS (wie bei echten Losen aus der Druckerei)
   1. ZUERST das Ergebnis: Beim Kauf wird aus der Gewinntabelle der
      Variante EIN Eintrag gezogen, gewichtet und mit echtem Zufall aus
      crypto.getRandomValues(). Damit steht der Gewinn fest.
   2. DANACH das Bild: aufbauen() erzeugt ein Los, das genau diesen
      Gewinn zeigt. Nieten bekommen oft "Beinahe-Treffer" (zwei gleiche
      Beträge, zwei gleiche Symbole …), genau wie echte Lose.
   3. Das Rubbeln deckt nur noch auf, was schon feststeht. Welche Felder
      man zuerst rubbelt, ändert nichts.
   4. gewinnAuswerten() liest den Gewinn noch einmal NUR aus dem Bild ab.
      Der Test prüft für jede Variante: Bild-Gewinn == gezogener Gewinn.

   AUSZAHLUNGSQUOTE (RTP) = Summe(Gewicht × Gewinn) / (Summe(Gewicht) × Preis).
   Alle Gewichte sind ganze Zahlen von GESAMT = 1.000.000, die Niete
   bekommt den Rest. So ist die Quote exakt ausrechenbar (rtpExakt).
   ============================================================ */

export const GESAMT = 1_000_000;

/* ------------------------------------------------------------
   ZUFALL
   ------------------------------------------------------------ */

/** Liefert eine Quelle für ganze Zufallszahlen 0 … 2^32−1 aus crypto.getRandomValues(). */
export function kryptoQuelle() {
  const puffer = new Uint32Array(64);
  let pos = puffer.length;
  return () => {
    if (pos >= puffer.length) {
      crypto.getRandomValues(puffer);
      pos = 0;
    }
    return puffer[pos++];
  };
}

/**
 * Ganze Zahl 0 … n−1 ohne "Modulo-Verzerrung": Zahlen oberhalb des größten
 * Vielfachen von n werden verworfen und neu gezogen. Sonst wären kleine
 * Ergebnisse minimal häufiger (2^32 ist nicht durch jedes n teilbar).
 */
export function zufallZahl(n, quelle) {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`n=${n}`);
  const grenze = Math.floor(2 ** 32 / n) * n;
  let x;
  do x = quelle();
  while (x >= grenze);
  return x % n;
}

export const waehle = (liste, quelle) => liste[zufallZahl(liste.length, quelle)];

/** Fisher-Yates-Mischen (ändert die Liste und gibt sie zurück). */
export function mischen(liste, quelle) {
  for (let i = liste.length - 1; i > 0; i--) {
    const j = zufallZahl(i + 1, quelle);
    [liste[i], liste[j]] = [liste[j], liste[i]];
  }
  return liste;
}

/** Zieht einen Eintrag der Tabelle, jeder mit Wahrscheinlichkeit gewicht / Summe. */
export function gewichtetZiehen(tabelle, quelle) {
  const summe = tabelle.reduce((s, e) => s + e.gewicht, 0);
  let r = zufallZahl(summe, quelle);
  for (const eintrag of tabelle) {
    if (r < eintrag.gewicht) return eintrag;
    r -= eintrag.gewicht;
  }
  throw new Error("unerreichbar");
}

/** Ergänzt die Niete (gewinn 0) mit dem Restgewicht bis GESAMT. */
function mitNiete(gewinne, nieteExtra = {}) {
  const summe = gewinne.reduce((s, e) => s + e.gewicht, 0);
  if (summe >= GESAMT) throw new Error("Gewichte zu groß");
  return [...gewinne, { gewinn: 0, gewicht: GESAMT - summe, ...nieteExtra }];
}

/* ------------------------------------------------------------
   VARIANTE 1: DREIERGLÜCK (10)
   9 Felder mit Beträgen. Drei gleiche Beträge gewinnen diesen Betrag.
   ------------------------------------------------------------ */

const DREIER_BETRAEGE = [10, 20, 30, 50, 100, 250, 1000, 10000];

const dreier = {
  id: "dreier",
  name: "Dreierglück",
  preis: 10,
  kurz: "3 gleiche Beträge gewinnen",
  tabelle: mitNiete([
    { gewinn: 10, gewicht: 215000 },
    { gewinn: 20, gewicht: 100000 },
    { gewinn: 30, gewicht: 40000 },
    { gewinn: 50, gewicht: 30000 },
    { gewinn: 100, gewicht: 12000 },
    { gewinn: 250, gewicht: 3000 },
    { gewinn: 1000, gewicht: 500 },
    { gewinn: 10000, gewicht: 30 },
  ]),
  /**
   * Gewinn G: dreimal G, die übrigen 6 Felder aus den anderen Beträgen,
   * jeder höchstens ZWEIMAL. Niete: alle 9 Felder, jeder Betrag höchstens zweimal.
   */
  aufbauen(eintrag, quelle) {
    const g = eintrag.gewinn;
    const vorrat = DREIER_BETRAEGE.filter((b) => b !== g).flatMap((b) => [b, b]);
    mischen(vorrat, quelle);
    const felder = g ? [g, g, g, ...vorrat.slice(0, 6)] : vorrat.slice(0, 9);
    return { felder: mischen(felder, quelle) };
  },
  gewinnAuswerten(karte) {
    const anzahl = new Map();
    for (const b of karte.felder) anzahl.set(b, (anzahl.get(b) ?? 0) + 1);
    let gewinn = 0;
    for (const [b, n] of anzahl) if (n >= 3) gewinn = Math.max(gewinn, b);
    return gewinn;
  },
};

/* ------------------------------------------------------------
   VARIANTE 2: GLÜCKSZAHLEN (20)
   2 Gewinnzahlen (1–30) und 10 eigene Zahlen, jede mit einem Betrag.
   Jede eigene Zahl, die einer Gewinnzahl gleicht, zahlt ihren Betrag.
   Das Bonusfeld "×2" verdoppelt den ganzen Gewinn.
   ------------------------------------------------------------ */

const GZ_BETRAEGE = [5, 10, 20, 40, 50, 100, 200, 500, 1000, 5000];
const GZ_ZAHLEN = 30;
const GZ_EIGENE = 10;

/** Ein Gewinnbild: welche Beträge getroffen werden und ob ×2 aufgedeckt wird. */
const gz = (treffer, x2, gewicht) => ({
  gewinn: treffer.reduce((s, b) => s + b, 0) * (x2 ? 2 : 1),
  treffer,
  x2,
  gewicht,
});

const glueckszahlen = {
  id: "zahlen",
  name: "Glückszahlen",
  preis: 20,
  kurz: "Triff die Gewinnzahlen",
  tabelle: mitNiete(
    [
      gz([20], false, 230000),
      gz([10, 10], false, 80000),
      gz([10], true, 70000),
      gz([5, 5, 10], false, 40000),
      gz([40], false, 70000),
      gz([20, 20], false, 35000),
      gz([20], true, 30000),
      gz([50, 50], false, 12000),
      gz([100], false, 10000),
      gz([50], true, 8000),
      gz([100, 100], false, 3000),
      gz([200], false, 2500),
      gz([100, 100], true, 1000),
      gz([500], false, 700),
      gz([500, 500], false, 250),
      gz([1000], true, 80),
      gz([5000], true, 12),
    ],
    { treffer: [], x2: false },
  ),
  aufbauen(eintrag, quelle) {
    const alle = mischen(
      Array.from({ length: GZ_ZAHLEN }, (_, i) => i + 1),
      quelle,
    );
    const gewinnzahlen = alle.slice(0, 2);
    const andere = alle.slice(2); // 28 Zahlen, die nie treffen
    const eigene = [];
    // Treffer: abwechselnd die erste und zweite Gewinnzahl
    eintrag.treffer.forEach((betrag, i) => eigene.push({ zahl: gewinnzahlen[i % 2], betrag }));
    let k = 0;
    while (eigene.length < GZ_EIGENE)
      eigene.push({ zahl: andere[k++], betrag: waehle(GZ_BETRAEGE, quelle) });
    mischen(eigene, quelle);
    return { gewinnzahlen, eigene, bonus: eintrag.x2 ? "x2" : "leer" };
  },
  gewinnAuswerten(karte) {
    const summe = karte.eigene
      .filter((e) => karte.gewinnzahlen.includes(e.zahl))
      .reduce((s, e) => s + e.betrag, 0);
    return summe * (karte.bonus === "x2" ? 2 : 1);
  },
};

/* ------------------------------------------------------------
   VARIANTE 3: GLÜCKSKLEE (25)
   6 Spiele, jedes mit 3 Symbolen und einem Betrag. Zeigt ein Spiel
   3 GLEICHE Symbole, gewinnst du seinen Betrag. Mehrere Spiele können
   gewinnen, dann zählt die Summe.
   ------------------------------------------------------------ */

export const KLEE_SYMBOLE = ["klee", "hufeisen", "stern", "herz", "glocke", "muenze"];
export const KLEE_SPIELE = 6;
const KLEE_BETRAEGE = [5, 10, 20, 25, 50, 100, 250, 500, 1000, 5000];

/** Gewinnbild: die Beträge der Spiele, die gewinnen. */
const summeVon = (liste) => liste.reduce((s, b) => s + b, 0);
const bild = (gewinne, gewicht) => ({ gewinn: summeVon(gewinne), gewinne, gewicht });

const gluecksklee = {
  id: "klee",
  name: "Glücksklee",
  preis: 25,
  kurz: "3 gleiche Symbole",
  tabelle: mitNiete(
    [
      bild([25], 260000),
      bild([50], 100000),
      bild([25, 25], 40000),
      bild([100], 30000),
      bild([50, 50], 15000),
      bild([250], 6000),
      bild([100, 100, 50], 4000),
      bild([500], 2000),
      bild([1000], 1000),
      bild([5000], 200),
      bild([5000, 5000], 30),
    ],
    { gewinne: [] },
  ),
  /** Gewinnspiele: 3 gleiche Symbole. Nieten-Spiele: nie 3 gleiche, oft 2 gleiche (Beinahe-Treffer). */
  aufbauen(eintrag, quelle) {
    const spiele = eintrag.gewinne.map((betrag) => {
      const s = waehle(KLEE_SYMBOLE, quelle);
      return { symbole: [s, s, s], betrag };
    });
    while (spiele.length < KLEE_SPIELE) {
      const symbole = [
        waehle(KLEE_SYMBOLE, quelle),
        waehle(KLEE_SYMBOLE, quelle),
        waehle(KLEE_SYMBOLE, quelle),
      ];
      if (symbole[0] === symbole[1] && symbole[1] === symbole[2]) continue;
      spiele.push({ symbole, betrag: waehle(KLEE_BETRAEGE, quelle) });
    }
    return { spiele: mischen(spiele, quelle) };
  },
  gewinnAuswerten(karte) {
    return summeVon(
      karte.spiele
        .filter((sp) => sp.symbole.every((x) => x === sp.symbole[0]))
        .map((sp) => sp.betrag),
    );
  },
};

/* ------------------------------------------------------------
   VARIANTE 4: SCHLAG DIE BANK (30)
   Eine Bankzahl und 6 eigene Zahlen (1–20, alle verschieden), jede mit
   einem Betrag. Jede eigene Zahl, die HÖHER ist als die Bankzahl,
   gewinnt ihren Betrag.
   ------------------------------------------------------------ */

const BANK_MAX = 20;
export const BANK_EIGENE = 6;
const BANK_BETRAEGE = [10, 15, 20, 30, 50, 60, 100, 300, 1000, 10000];

const schlagDieBank = {
  id: "bank",
  name: "Schlag die Bank",
  preis: 30,
  kurz: "Höher als die Bank",
  tabelle: mitNiete(
    [
      bild([30], 300000),
      bild([15, 15], 60000),
      bild([60], 90000),
      bild([20, 10, 30], 30000),
      bild([100], 35000),
      bild([50, 50], 15000),
      bild([300], 8000),
      bild([100, 100, 100], 2000),
      bild([1000], 2000),
      bild([10000], 50),
    ],
    { gewinne: [] },
  ),
  aufbauen(eintrag, quelle) {
    const k = eintrag.gewinne.length;
    // Bankzahl so, dass k Zahlen darüber und 6 − k Zahlen darunter Platz haben
    const unten = BANK_EIGENE - k + 1; // kleinste mögliche Bankzahl
    const oben = BANK_MAX - k; // größte mögliche Bankzahl
    const bank = unten + zufallZahl(oben - unten + 1, quelle);
    const hoeher = mischen(
      Array.from({ length: BANK_MAX - bank }, (_, i) => bank + 1 + i),
      quelle,
    );
    const tiefer = mischen(
      Array.from({ length: bank - 1 }, (_, i) => i + 1),
      quelle,
    );
    const eigene = [
      ...eintrag.gewinne.map((betrag, i) => ({ zahl: hoeher[i], betrag })),
      ...tiefer
        .slice(0, BANK_EIGENE - k)
        .map((zahl) => ({ zahl, betrag: waehle(BANK_BETRAEGE, quelle) })),
    ];
    return { bank, eigene: mischen(eigene, quelle) };
  },
  gewinnAuswerten(karte) {
    return summeVon(karte.eigene.filter((e) => e.zahl > karte.bank).map((e) => e.betrag));
  },
};

/* ------------------------------------------------------------
   VARIANTE 4: GOLDMINE (50)
   3 Stollen. Jeder zeigt einen Fund (Goldbetrag oder Geröll) und einen
   Multiplikator. Gewinn = Summe aus Gold × Multiplikator aller Stollen.
   ------------------------------------------------------------ */

const GOLD_BETRAEGE = [10, 25, 50, 100, 250, 500, 1000];
const GOLD_MULTI = [1, 2, 3, 5, 10, 20];
export const GOLD_STOLLEN = 3;

/** Alle Zerlegungen von g in 1 oder 2 Stollen: [[betrag, multi], …]. */
function goldZerlegungen(g) {
  const paare = GOLD_BETRAEGE.flatMap((b) => GOLD_MULTI.map((m) => [b, m]));
  const out = paare.filter(([b, m]) => b * m === g).map((p) => [p]);
  for (let i = 0; i < paare.length; i++)
    for (let j = i; j < paare.length; j++) {
      const [b1, m1] = paare[i];
      const [b2, m2] = paare[j];
      if (b1 * m1 + b2 * m2 === g) out.push([paare[i], paare[j]]);
    }
  return out;
}

const goldmine = {
  id: "gold",
  name: "Goldmine",
  preis: 50,
  kurz: "Gold × Multiplikator",
  tabelle: mitNiete([
    { gewinn: 50, gewicht: 230000 },
    { gewinn: 100, gewicht: 90000 },
    { gewinn: 150, gewicht: 45000 },
    { gewinn: 250, gewicht: 35000 },
    { gewinn: 500, gewicht: 12000 },
    { gewinn: 1000, gewicht: 3000 },
    { gewinn: 2500, gewicht: 600 },
    { gewinn: 5000, gewicht: 200 },
    { gewinn: 20000, gewicht: 20 },
  ]),
  aufbauen(eintrag, quelle) {
    const funde = eintrag.gewinn ? waehle(goldZerlegungen(eintrag.gewinn), quelle) : [];
    const stollen = funde.map(([gold, multi]) => ({ gold, multi }));
    // Geröll-Stollen zeigen auch einen Multiplikator, gern einen hohen (Beinahe-Gewinn)
    while (stollen.length < GOLD_STOLLEN)
      stollen.push({ gold: 0, multi: waehle(GOLD_MULTI, quelle) });
    return { stollen: mischen(stollen, quelle) };
  },
  gewinnAuswerten(karte) {
    return karte.stollen.reduce((s, st) => s + st.gold * st.multi, 0);
  },
};

/* ------------------------------------------------------------
   GEMEINSAM
   ------------------------------------------------------------ */

export const VARIANTEN = [dreier, glueckszahlen, gluecksklee, schlagDieBank, goldmine];
export const variante = (id) => VARIANTEN.find((v) => v.id === id);
export const GUENSTIGSTES_LOS = Math.min(...VARIANTEN.map((v) => v.preis));

/** Exakte Auszahlungsquote einer Variante (0 … 1) aus ihrer Tabelle. */
export function rtpExakt(v) {
  const summe = v.tabelle.reduce((s, e) => s + e.gewicht, 0);
  const auszahlung = v.tabelle.reduce((s, e) => s + e.gewicht * e.gewinn, 0);
  return auszahlung / (summe * v.preis);
}

/** Gewinnchance (irgendein Gewinn > 0) einer Variante. */
export function gewinnChance(v) {
  const summe = v.tabelle.reduce((s, e) => s + e.gewicht, 0);
  return v.tabelle.filter((e) => e.gewinn > 0).reduce((s, e) => s + e.gewicht, 0) / summe;
}

/**
 * Gewinnplan für die Anzeige: je Gewinnbetrag die Chance "1 zu N",
 * absteigend sortiert. Mehrere Tabellenzeilen mit gleichem Gewinn
 * (Glückszahlen) werden zusammengefasst.
 */
export function gewinnplan(v) {
  const summe = v.tabelle.reduce((s, e) => s + e.gewicht, 0);
  const proBetrag = new Map();
  for (const e of v.tabelle)
    if (e.gewinn > 0) proBetrag.set(e.gewinn, (proBetrag.get(e.gewinn) ?? 0) + e.gewicht);
  return [...proBetrag]
    .sort((a, b) => b[0] - a[0])
    .map(([gewinn, gewicht]) => ({ gewinn, einsZu: summe / gewicht }));
}

/**
 * Kauft ein Los: zieht das Ergebnis und baut das passende Bild.
 * Ergebnis (nur Daten, speicherbar als JSON):
 *   { variante, preis, gewinn, ...bild }
 */
export function losZiehen(id, quelle = kryptoQuelle()) {
  const v = variante(id);
  if (!v) throw new Error(`unbekannte Variante ${id}`);
  const eintrag = gewichtetZiehen(v.tabelle, quelle);
  const bild = v.aufbauen(eintrag, quelle);
  return { variante: v.id, preis: v.preis, gewinn: eintrag.gewinn, ...bild };
}

/** Liest den Gewinn allein aus dem Bild eines Loses ab. */
export function gewinnAuswerten(karte) {
  return variante(karte.variante).gewinnAuswerten(karte);
}
