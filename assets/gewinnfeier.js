/* ============================================================
   gewinnfeier.js · Eskalierende Gewinn-Animationen für die Slots
   ------------------------------------------------------------
   SO FUNKTIONIERT DIESES MODUL
   1. Idee: Je größer der Gewinn im Verhältnis zum EINSATZ, desto wilder
      wird die Feier. Echte Automaten machen das genauso: kleine Gewinne
      bleiben leise, große werden gefeiert, riesige eskalieren.
      Gemessen wird nie der absolute Betrag, sondern der FAKTOR
      (Auszahlung geteilt durch Gesamteinsatz). 250 bei Einsatz 10 ist
      also ein x25-Gewinn, 250 bei Einsatz 100 nur ein x2,5-Gewinn.
      Dadurch skaliert alles automatisch mit dem gewählten Einsatz.
   2. Die Stufen stehen als Daten in der Konstante STUFEN (Schwelle, Name,
      Dauer). Die Stufenwahl selbst ist eine REINE Funktion
      (stufeBestimmen): kein DOM, kein Zufall, in Node testbar.
        Stufe 0   Faktor unter x5     nichts (die normale Gewinn-Anzeige reicht)
        Stufe 1   ab x5               "SCHÖNER GEWINN"  Banner, ca. 1,2 s
        Stufe 2   ab x15              "GROSSER GEWINN"  Overlay, ca. 2,5 s
        Stufe 3   ab x40              "MEGA GEWINN"     Vollbild-Overlay, ca. 4 s
   3. Die Hauptfunktion gewinnFeiern({ buehne, betrag, einsatz }) baut ein
      Overlay IN die .buehne (position:absolute, nie über die ganze Seite),
      lässt den Betrag hochticken und gibt ein Promise zurück. Das Promise
      wird erst erfüllt, wenn die Feier vorbei oder übersprungen ist. Die
      Spiele schreiben deshalb einfach:
          await gewinnFeiern({ buehne, betrag: auszahlung, einsatz });
      und entsperren ihre Knöpfe danach.
   4. ÜBERSPRINGEN: Jeder Klick und jeder Tastendruck beendet die Feier
      sofort (der Endbetrag blitzt kurz auf). Wer 200 Drehs am Stück spielt,
      wird so nie ausgebremst.
   5. BEWEGUNG REDUZIEREN: Dann gibt es weder Partikel noch Ticker noch
      Leucht-Animationen, nur das Banner mit dem Stufen-Namen und dem
      Endbetrag, kurz und statisch (ca. 0,8 s).
   6. LERNKERN: die kleine PARTIKEL-ENGINE weiter unten (Münz- und Funken-
      regen auf einem <canvas>). Sie zeigt in ca. 60 Zeilen das Grundprinzip
      jeder Spiele-Physik: Ort, Geschwindigkeit, Gravitation, Zeitschritt.
   7. Das Modul ändert NICHTS an Auszahlung, Wallet oder Toplisten. Es zeigt
      nur an, was schon feststeht.
   ============================================================ */

import { bewegungReduziert } from "./ui.js";

/* ============================================================
   TEIL 1: STUFEN (reine Daten und reine Funktionen, ohne DOM)
   ============================================================ */

/**
 * Die Eskalationsstufen, aufsteigend sortiert. Stufe 1 = erster Eintrag usw.
 * abFaktor  Schwelle: Auszahlung / Gesamteinsatz muss mindestens so groß sein
 * name      Text im Banner
 * dauerMs   Gesamtdauer der Feier (inklusive kurzem Ausblenden am Ende)
 * tickerMs  So lange tickt der Betrag hoch, den Rest der Zeit steht er final da
 * Die Lernboxen der Spiele nennen diese Schwellen (x5 / x15 / x40).
 */
export const STUFEN = [
  { abFaktor: 5, name: "SCHÖNER GEWINN", dauerMs: 1200, tickerMs: 700 },
  { abFaktor: 15, name: "GROSSER GEWINN", dauerMs: 2500, tickerMs: 1500 },
  { abFaktor: 40, name: "MEGA GEWINN", dauerMs: 4000, tickerMs: 3000 },
];

const DAUER_REDUZIERT_MS = 800; // Banner bei "Bewegung reduzieren"
const AUSBLENDEN_MS = 220; // sanftes Ausblenden am natürlichen Ende
const AUSBLENDEN_SKIP_MS = 120; // kurzes Ausblenden nach Klick/Taste

/**
 * Bestimmt die Stufe (0 bis STUFEN.length) aus Auszahlung und Gesamteinsatz.
 *
 * Verglichen wird per MULTIPLIKATION (betrag >= abFaktor * einsatz) statt per
 * Division. Grund: Bei Divisionen mit Kommazahlen kann ein Rundungsfehler eine
 * Schwelle knapp verfehlen (z. B. 0,1 + 0,2 !== 0,3). Mit ganzen Zahlen ist
 * die Multiplikation exakt.
 * Ein Einsatz von 0 (oder negativ, NaN …) ergibt Stufe 0: Es gibt keinen
 * Faktor, und die Division durch 0 wird gar nicht erst versucht.
 */
export function stufeBestimmen(betrag, einsatz) {
  if (!Number.isFinite(betrag) || !Number.isFinite(einsatz) || einsatz <= 0 || betrag <= 0)
    return 0;
  let stufe = 0;
  STUFEN.forEach((s, i) => {
    if (betrag >= s.abFaktor * einsatz) stufe = i + 1;
  });
  return stufe;
}

/** Dasselbe für einen fertigen Faktor (x = Auszahlung / Einsatz): Faktor 4,9 -> 0, 5 -> 1, 15 -> 2, 40 -> 3. */
export function stufeFuerFaktor(faktor) {
  return stufeBestimmen(faktor, 1);
}

/** Zahl mit Tausenderpunkt: 1250 -> "1.250". */
function zahlText(n) {
  return Math.round(n).toLocaleString("de-DE");
}

/** Faktor als Text, höchstens eine Nachkommastelle: 42 -> "42", 17,5 -> "17,5". */
function faktorText(faktor) {
  return faktor.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

/**
 * Ticker-Kurve für die MEGA-Feier: Der Betrag tickt in ETAPPEN hoch, erst
 * schnell, am Ende langsam (wie bei einem Automaten, der den Gewinn
 * "auslaufen" lässt). Jede Etappe sagt: "Bis zum Zeitpunkt bisZeit (Anteil der
 * Ticker-Dauer, 0 bis 1) soll bisWert (Anteil des Endbetrags, 0 bis 1)
 * erreicht sein." Dazwischen wird linear aufgefüllt. Die Steigung wird von
 * Etappe zu Etappe flacher: 2,0 / 0,83 / 0,48 / 0,2. Das letzte Viertel der
 * Zeit bringt nur noch 3 % des Betrags, die letzten Ziffern kriechen also.
 */
export const MEGA_ETAPPEN = [
  { bisZeit: 0.3, bisWert: 0.6 },
  { bisZeit: 0.6, bisWert: 0.85 },
  { bisZeit: 0.85, bisWert: 0.97 },
  { bisZeit: 1.0, bisWert: 1.0 },
];

/** Rechnet eine Zeit t (0 bis 1) in einen Wert-Anteil (0 bis 1) um, Etappe für Etappe. */
export function etappenFortschritt(t, etappen = MEGA_ETAPPEN) {
  const zeit = Math.min(Math.max(t, 0), 1);
  let vonZeit = 0;
  let vonWert = 0;
  for (const e of etappen) {
    if (zeit <= e.bisZeit) {
      return vonWert + ((e.bisWert - vonWert) * (zeit - vonZeit)) / (e.bisZeit - vonZeit);
    }
    vonZeit = e.bisZeit;
    vonWert = e.bisWert;
  }
  return 1;
}

/** easeOut: am Anfang schnell, am Ende sanft auslaufend (für Stufe 1 und 2). */
function easeOut(t) {
  return 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
}

/* ============================================================
   TEIL 2: DIE PARTIKEL-ENGINE (der Lernkern)
   ------------------------------------------------------------
   Ein "Partikel" ist nur ein kleines Objekt mit Ort (x, y) und Geschwindig-
   keit (vx, vy), Einheiten: Pixel und Pixel pro Sekunde. Eine Partikel-Engine
   macht in jedem Bild (Frame) nur drei Dinge:
     1. SCHRITT   Physik für jedes Partikel um dt Sekunden weiterrechnen
     2. AUFRÄUMEN tote Partikel entfernen (verbrannt oder aus dem Bild gefallen)
     3. ZEICHNEN  alle übrigen auf den Canvas malen
   Die Physik ist das "Euler-Verfahren", die einfachste Art, Bewegung zu
   simulieren. Pro Zeitschritt dt gilt:
        vy = vy + g * dt        Gravitation ändert die GESCHWINDIGKEIT
        x  = x  + vx * dt       die Geschwindigkeit ändert den ORT
        y  = y  + vy * dt
   Zuerst die Geschwindigkeit, dann den Ort: Beschleunigung -> Geschwindigkeit
   -> Position. Das ist alles. Ein nach oben geschossenes Partikel (vy
   negativ, denn auf dem Canvas wächst y nach UNTEN) wird von g erst
   abgebremst, bleibt einen Moment stehen und fällt dann zurück: genau die
   Wurfparabel, die man aus dem Physikunterricht kennt.
   WICHTIG ist dt (die echte Zeit seit dem letzten Frame), nicht "ein Schritt
   pro Frame". Sonst würde die Feier auf einem 144-Hz-Bildschirm mehr als
   doppelt so schnell laufen wie auf einem 60-Hz-Bildschirm.
   ============================================================ */

export const PARTIKEL_MAX = 90; // so viele Partikel leben höchstens gleichzeitig (Obergrenze für die Leistung)
export const GRAVITATION = 900; // Pixel pro Sekunde zum Quadrat (auf der Erde wären es ca. 9,81 Meter)
const WIDERSTAND = 0.4; // Luftwiderstand: Anteil der Geschwindigkeit, der pro Sekunde verloren geht

/**
 * Erzeugt ein neues Partikel. `art` bestimmt Startort und Anfangsgeschwindigkeit:
 *   "fontaene"  schießt aus dem Punkt (quelleX, quelleY) nach oben und fächert
 *               sich auf (Zufall für Winkel und Tempo)
 *   "regen"     fällt von der Oberkante herab, mit leichtem Zufalls-Drift
 * Ob Münze oder Funke, entscheidet ebenfalls der Zufall. `zufall` ist
 * austauschbar (Standard Math.random), damit Tests feste Werte vorgeben können.
 * Rückgabe: ein schlichtes Objekt, keine Klasse nötig.
 */
export function partikelNeu(art, breite, quelleX, quelleY, zufall = Math.random) {
  const zwischen = (min, max) => min + zufall() * (max - min);
  const istMuenze = zufall() < (art === "regen" ? 0.85 : 0.45);
  const p = {
    art: istMuenze ? "muenze" : "funke",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    groesse: istMuenze ? zwischen(5, 9) : zwischen(2, 4), // Radius der Münze bzw. Kantenlänge des Funkens in Pixeln
    winkel: zwischen(0, Math.PI * 2), // Drehwinkel der Münze (für den "Wende"-Effekt)
    drehTempo: zwischen(4, 11), // Radiant pro Sekunde
    schwere: istMuenze ? 1 : 0.45, // Funken sind leicht, sie fallen langsamer
    alter: 0,
    leben: istMuenze ? 8 : zwischen(0.6, 1.4), // Münzen leben, bis sie unten rausfallen; Funken verglühen
  };
  if (art === "regen") {
    p.x = zwischen(0, breite);
    p.y = -10;
    p.vx = zwischen(-30, 30);
    p.vy = zwischen(60, 220);
  } else {
    // Fontäne: Winkel zwischen -150° und -30° (also nach oben), dazu ein zufälliges Tempo.
    const richtung = zwischen((-Math.PI * 5) / 6, -Math.PI / 6);
    const tempo = zwischen(260, 760);
    p.x = quelleX;
    p.y = quelleY;
    p.vx = Math.cos(richtung) * tempo;
    p.vy = Math.sin(richtung) * tempo;
  }
  return p;
}

/**
 * Der Physik-Schritt für EIN Partikel, dt in Sekunden. Genau die Rechnung aus
 * dem Kommentar oben: Gravitation -> Geschwindigkeit -> Ort. Die Funktion
 * verändert das Partikel direkt (mutiert es), das spart Speicher, denn bei
 * 60 Bildern pro Sekunde und rund 90 Partikeln entstünden sonst 5400 neue
 * Objekte pro Sekunde, die der Garbage Collector wegräumen müsste.
 */
export function partikelSchritt(p, dt, gravitation = GRAVITATION) {
  p.vy += gravitation * p.schwere * dt; // 1. Beschleunigung: die Schwerkraft zieht nach unten
  p.vx -= p.vx * WIDERSTAND * dt; //    Luftwiderstand bremst die Seitwärtsbewegung
  p.x += p.vx * dt; // 2. Geschwindigkeit: der Ort wandert mit
  p.y += p.vy * dt;
  p.winkel += p.drehTempo * dt; // 3. Die Münze dreht sich weiter
  p.alter += dt; // 4. Das Partikel wird älter
}

/** Lebt das Partikel noch? Tot ist es, wenn es zu alt ist oder unten aus dem Bild fiel. */
export function partikelLebt(p, hoehe) {
  return p.alter < p.leben && p.y < hoehe + 20;
}

/**
 * Das Partikelsystem für einen Canvas. Es merkt sich die Liste der lebenden
 * Partikel und bietet drei Handgriffe: ausstossen (neue Partikel), schritt
 * (Physik + Aufräumen + Zeichnen) und anzahl.
 *   farbe  Goldton der Münzen/Funken (aus var(--gold) gelesen)
 *   gr     Größe des Zeichenbereichs in CSS-Pixeln { breite, hoehe }
 */
function partikelSystemBauen(canvas, farbe, zufall = Math.random) {
  const ctx = canvas.getContext("2d");
  const liste = [];
  let breite = 0;
  let hoehe = 0;

  /** Canvas-Auflösung an die Anzeigegröße anpassen (scharf auch auf Retina-Bildschirmen, aber höchstens 2x). */
  function groesseAnpassen() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    breite = canvas.clientWidth;
    hoehe = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(breite * dpr));
    canvas.height = Math.max(1, Math.round(hoehe * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // ab jetzt kann man in CSS-Pixeln malen
  }
  groesseAnpassen();

  /** Stößt `anzahl` neue Partikel aus (nie mehr als PARTIKEL_MAX insgesamt). */
  function ausstossen(art, anzahl, quelleX, quelleY) {
    for (let i = 0; i < anzahl && liste.length < PARTIKEL_MAX; i++) {
      liste.push(partikelNeu(art, breite, quelleX, quelleY, zufall));
    }
  }

  function zeichnen() {
    ctx.clearRect(0, 0, breite, hoehe);
    for (const p of liste) {
      if (p.art === "muenze") {
        // Die Drehung um die senkrechte Achse täuscht man mit einer schmaler werdenden Ellipse vor:
        // |cos(winkel)| ist 1 (Münze von vorn), dann 0 (Kante), dann wieder 1.
        const breiteFaktor = Math.max(Math.abs(Math.cos(p.winkel)), 0.15);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(breiteFaktor, 1);
        ctx.beginPath();
        ctx.arc(0, 0, p.groesse, 0, Math.PI * 2);
        ctx.fillStyle = farbe;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#a8680f";
        ctx.stroke();
        ctx.restore();
      } else {
        // Funke: kleines helles Quadrat (passt zur Pixel-Optik), das mit dem Alter ausblendet.
        ctx.globalAlpha = Math.max(0, 1 - p.alter / p.leben);
        ctx.fillStyle = "#fff3b0";
        ctx.fillRect(p.x - p.groesse / 2, p.y - p.groesse / 2, p.groesse, p.groesse);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Ein Frame: Physik für alle, tote Partikel entfernen, zeichnen. */
  function schritt(dt) {
    // Rückwärts durch die Liste gehen, damit man beim Löschen (splice) keinen Eintrag überspringt.
    for (let i = liste.length - 1; i >= 0; i--) {
      partikelSchritt(liste[i], dt);
      if (!partikelLebt(liste[i], hoehe)) liste.splice(i, 1);
    }
    zeichnen();
  }

  return {
    ausstossen,
    schritt,
    groesseAnpassen,
    anzahl: () => liste.length,
    groesse: () => ({ breite, hoehe }),
  };
}

/* ============================================================
   TEIL 3: DOM-AUFBAU UND ABLAUF DER FEIER
   ============================================================ */

/** Es läuft immer höchstens eine Feier. Eine neue beendet die alte sofort. */
let aktiveFeier = null;

/** Kleiner Helfer: Element mit Klasse und optionalem Text. */
function el(tag, klasse, text) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Misst, wo das Overlay liegen soll (alles relativ zur Innenkante der Bühne):
 *   hoehe   Das Overlay reicht von der Oberkante der Bühne bis zum Element mit
 *           data-gewinnfeier-bis (bei den Slots die Gewinntabelle, denn die
 *           liegt ebenfalls in der .buehne). Fehlt das Attribut: ganze Bühne.
 *   fokusY  Der Text sitzt auf der Mitte des Elements mit
 *           data-gewinnfeier-fokus (das Walzenfenster). Fehlt es: Mitte.
 */
function bereichMessen(buehne) {
  const rahmen = buehne.getBoundingClientRect();
  const oben = rahmen.top + buehne.clientTop;
  const bis = buehne.querySelector("[data-gewinnfeier-bis]");
  const fokus = buehne.querySelector("[data-gewinnfeier-fokus]");
  const hoehe = bis ? Math.max(bis.getBoundingClientRect().top - oben, 120) : buehne.clientHeight;
  let fokusY = hoehe / 2;
  if (fokus) {
    const f = fokus.getBoundingClientRect();
    fokusY = Math.min(Math.max(f.top - oben + f.height / 2, 0), hoehe);
  }
  return { hoehe, fokusY };
}

/**
 * Meldet "Klick" und "Taste" als Abkürzung an. Gibt eine Funktion zurück, die
 * beides wieder abmeldet. Die Listener hängen mit "capture" am document: Sie
 * sehen jeden Klick und jede Taste VOR den Spielen. Die Spiele ignorieren in
 * dieser Zeit ohnehin alles (ihr Flag "laeuft" ist noch gesetzt).
 */
function ueberspringenAnmelden(beiUeberspringen) {
  const taste = (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return; // Dauerdruck und Browser-Kürzel nicht
    if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key)) return;
    if (e.key === " ") e.preventDefault(); // die Leertaste soll die Seite nicht scrollen
    beiUeberspringen();
  };
  const zeiger = (e) => {
    beiUeberspringen();
    // Der Klick, der zu diesem pointerdown gehört, kommt erst beim Loslassen. Landet er auf einem
    // Knopf (z. B. DREHEN, der inzwischen entsperrt ist), würde sofort ein neuer Dreh starten.
    // Diesen einen Klick schlucken wir deshalb.
    if (e.target instanceof Element && e.target.closest("button")) {
      const schlucken = (klick) => {
        klick.stopPropagation();
        klick.preventDefault();
        document.removeEventListener("click", schlucken, true);
      };
      document.addEventListener("click", schlucken, true);
      setTimeout(() => document.removeEventListener("click", schlucken, true), 600);
    }
  };
  document.addEventListener("keydown", taste, true);
  document.addEventListener("pointerdown", zeiger, true);
  return () => {
    document.removeEventListener("keydown", taste, true);
    document.removeEventListener("pointerdown", zeiger, true);
  };
}

/**
 * Feiert einen Gewinn. Gibt ein Promise zurück, das ERST erfüllt wird, wenn die
 * Feier vorbei oder übersprungen ist (Ergebnis: die gezeigte Stufe, 0 = keine Feier).
 *
 *   buehne   das .buehne-Element, in das das Overlay gelegt wird
 *   betrag   Brutto-Auszahlung (Dreh oder ganze Freispiel-Serie)
 *   einsatz  Gesamteinsatz, auf den sich der Faktor bezieht
 *   zusatz   optional: kleine Zeile über dem Stufen-Namen (z. B. "FREISPIELE GESAMT")
 */
export async function gewinnFeiern({ buehne, betrag, einsatz, zusatz = "" }) {
  const stufe = stufeBestimmen(betrag, einsatz);
  if (stufe === 0 || !buehne) return 0;
  if (aktiveFeier) aktiveFeier.abbrechen();

  const daten = STUFEN[stufe - 1];
  const reduziert = bewegungReduziert();
  const dauerMs = reduziert ? DAUER_REDUZIERT_MS : daten.dauerMs;
  const endbetrag = Math.round(betrag);
  const faktor = betrag / einsatz;
  const { hoehe, fokusY } = bereichMessen(buehne);

  // ---------- Aufbau des Overlays ----------
  // Stufe 1 und "Bewegung reduzieren" zeigen nur das Banner (Klasse stufe-1);
  // Stufe 2 und 3 zeigen das große Overlay mit Betrag.
  const nurBanner = reduziert || stufe === 1;
  const wurzel = el(
    "div",
    `gewinnfeier ${nurBanner ? "stufe-1" : `stufe-${stufe}`}${reduziert ? " reduziert" : ""}`,
  );
  wurzel.style.height = `${hoehe}px`;
  wurzel.style.setProperty("--gf-y", `${fokusY}px`);
  // Die sichtbaren Teile sind Deko für die Augen; Screenreader bekommen stattdessen EINEN ruhigen Satz (gf-sr).
  const lesetext = el("span", "gf-sr");
  lesetext.setAttribute("role", "status");
  wurzel.append(lesetext);

  let betragElement;
  let canvas = null;
  if (nurBanner) {
    const banner = el("div", "gf-banner");
    banner.setAttribute("aria-hidden", "true");
    betragElement = el("span", "gf-betrag", reduziert ? zahlText(endbetrag) : "0");
    banner.append(el("span", "gf-name", daten.name), betragElement);
    wurzel.append(banner);
  } else {
    wurzel.append(el("div", "gf-glow"));
    if (stufe === 3) {
      wurzel.append(el("div", "gf-strahlen"));
      canvas = el("canvas", "gf-partikel");
      wurzel.append(canvas);
    } else {
      // Stufe 2: ein paar einzelne Funken steigen auf (reines CSS, jeder Funke mit eigenen Zufallswerten).
      for (let i = 0; i < 14; i++) {
        const funke = el("i", "gf-funke");
        funke.style.setProperty("--x", `${Math.round(6 + Math.random() * 88)}%`);
        funke.style.setProperty("--dauer", `${(1.1 + Math.random() * 1.2).toFixed(2)}s`);
        funke.style.setProperty("--verz", `${(Math.random() * 1.6).toFixed(2)}s`);
        wurzel.append(funke);
      }
    }
    const inhalt = el("div", "gf-inhalt");
    inhalt.setAttribute("aria-hidden", "true");
    if (zusatz) inhalt.append(el("div", "gf-zusatz", zusatz));
    betragElement = el("div", "gf-betrag", "0");
    inhalt.append(
      el("div", "gf-name", daten.name),
      betragElement,
      el("div", "gf-faktor", `×${faktorText(faktor)} vom Einsatz`),
    );
    wurzel.append(inhalt, el("div", "gf-hinweis", "Klick oder Taste überspringt"));
  }

  // Leuchten der Bühne selbst (Rahmen + Schein), je Stufe stärker. Wird am Ende wieder entfernt.
  const leuchtKlasse = `gf-leuchten-${stufe}`;
  if (!reduziert) buehne.classList.add(leuchtKlasse);
  buehne.append(wurzel);
  // Der Lesetext wird erst NACH dem Einfügen gesetzt, sonst meldet ihn mancher Screenreader nicht.
  setTimeout(() => {
    lesetext.textContent = `${daten.name}${zusatz ? `, ${zusatz}` : ""}: ${zahlText(endbetrag)} Auszahlung, ${faktorText(faktor)}-facher Einsatz.`;
  }, 30);

  const farbe = getComputedStyle(buehne).getPropertyValue("--gold").trim() || "#ffc84d";
  const partikel = canvas ? partikelSystemBauen(canvas, farbe) : null;
  const beiGroessenAenderung = () => partikel?.groesseAnpassen();
  if (partikel) window.addEventListener("resize", beiGroessenAenderung);

  return new Promise((fertig) => {
    let beendet = false;
    let rafId = 0;
    let notfallTimer = 0;
    const start = performance.now();

    /** Beendet die Feier genau einmal. grund: "ende" (Zeit um), "ueberspringen" oder "abbrechen". */
    function beenden(grund) {
      if (beendet) return;
      beendet = true;
      cancelAnimationFrame(rafId);
      clearTimeout(notfallTimer);
      abmelden();
      window.removeEventListener("resize", beiGroessenAenderung);
      if (aktiveFeier === handle) aktiveFeier = null;
      buehne.classList.remove(leuchtKlasse);
      // Wer überspringt, sieht den Endbetrag trotzdem noch einen Wimpernschlag lang.
      betragElement.textContent = zahlText(endbetrag);
      const ausblenden = grund === "ende" ? AUSBLENDEN_MS : AUSBLENDEN_SKIP_MS;
      wurzel.classList.add(grund === "ende" ? "weg" : "weg-schnell");
      setTimeout(
        () => {
          wurzel.remove();
          fertig(stufe);
        },
        grund === "abbrechen" ? 0 : ausblenden,
      );
    }

    const abmelden = ueberspringenAnmelden(() => beenden("ueberspringen"));
    const handle = { abbrechen: () => beenden("abbrechen") };
    aktiveFeier = handle;
    // Falls der Tab im Hintergrund liegt und requestAnimationFrame pausiert: trotzdem zuverlässig fertig werden.
    notfallTimer = setTimeout(() => beenden("ende"), dauerMs + 600);

    if (reduziert) {
      // Kein Ticker, keine Partikel: nur das statische Banner, dann Ende.
      setTimeout(() => beenden("ende"), dauerMs - AUSBLENDEN_MS);
      return;
    }

    // ---------- Die Animationsschleife ----------
    // requestAnimationFrame ruft `bild` einmal pro Bildschirm-Frame auf. Alles hängt an der ECHTEN
    // Zeit (jetzt - start), nicht an der Anzahl der Frames: gleiche Dauer auf 60 und 144 Hz.
    let letzterFrame = start;
    let ausstossRest = 0; // Bruchteil eines noch nicht ausgestoßenen Partikels (Rate x dt ist selten ganzzahlig)
    let knallGezeigt = false;
    let naechsterStoss = 0; // Zeitpunkt (ms) des nächsten Fontänen-Stoßes; 0 = der große erste Stoß beim Start
    function bild(jetzt) {
      if (beendet) return;
      const vergangen = jetzt - start;
      const dt = Math.min((jetzt - letzterFrame) / 1000, 0.05); // höchstens 50 ms: nach einem Ruckler nicht "teleportieren"
      letzterFrame = jetzt;

      // 1. Ticker: Betrag hochzählen
      const tickerT = vergangen / daten.tickerMs;
      const anteil = stufe === 3 ? etappenFortschritt(tickerT) : easeOut(tickerT);
      betragElement.textContent = zahlText(endbetrag * anteil);
      if (tickerT >= 1 && !knallGezeigt) {
        knallGezeigt = true;
        wurzel.classList.add("fertig"); // CSS lässt den Endbetrag einmal "einschlagen"
      }

      // 2. Partikel (nur Stufe 3): am Anfang eine große Fontäne, danach gleichmäßiger Regen bis kurz vor
      //    Schluss, dazwischen alle ca. 1,4 Sekunden ein kleiner Fontänen-Stoß.
      if (partikel) {
        const { breite } = partikel.groesse();
        if (vergangen >= naechsterStoss) {
          partikel.ausstossen("fontaene", naechsterStoss === 0 ? 45 : 12, breite / 2, fokusY);
          naechsterStoss = naechsterStoss === 0 ? 1400 : naechsterStoss + 1400;
        }
        if (vergangen < dauerMs - 900) {
          ausstossRest += 24 * dt; // 24 Regen-Partikel pro Sekunde
          const ganze = Math.floor(ausstossRest);
          ausstossRest -= ganze;
          partikel.ausstossen("regen", ganze, 0, 0);
        }
        partikel.schritt(dt);
      }

      // 3. Zeit um?
      if (vergangen >= dauerMs - AUSBLENDEN_MS) {
        beenden("ende");
        return;
      }
      rafId = requestAnimationFrame(bild);
    }
    rafId = requestAnimationFrame(bild);
  });
}
