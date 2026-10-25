/* ============================================================
   GLÜCKSLOS · design.js – Losdesigns (eigene SVG-Motive, Folien-
   farben, Seriennummer mit Strichcode, Kleingedrucktes).
   Reine Gestaltung, keine Spiellogik.
   ============================================================ */
const svg = (inhalt) => `<svg viewBox="0 0 64 64" aria-hidden="true">${inhalt}</svg>`;
const stern = (x, y, r, f = "#fff6c4") =>
  `<path d="M${x} ${y - r}l${r * 0.29} ${r * 0.6} ${r * 0.66} .1-${r * 0.48} ${r * 0.45} .12 ${r * 0.66}-${r * 0.59}-${r * 0.31}-${r * 0.59} ${r * 0.31} .12-${r * 0.66}-${r * 0.48}-${r * 0.45} ${r * 0.66}-.1z" fill="${f}"/>`;

export const MOTIV = {
  // Drei gestapelte Münzen mit Funkeln
  dreier: svg(
    [
      [18, 44],
      [46, 44],
      [32, 22],
    ]
      .map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="13" fill="#a8740a"/><circle cx="${x}" cy="${y - 1.5}" r="13" fill="#ffcf4a"/><circle cx="${x}" cy="${y - 1.5}" r="9" fill="none" stroke="#c68a10" stroke-width="2"/><text x="${x}" y="${y + 3.5}" font-size="13" font-weight="900" text-anchor="middle" fill="#8a5a06" font-family="sans-serif">3</text>`,
      )
      .join("") +
      stern(54, 12, 6) +
      stern(9, 18, 4),
  ),
  // Lostrommel-Kugeln
  zahlen: svg(
    [
      [20, 40, "#3d7bff", 7],
      [42, 42, "#ff5a5a", 21],
      [31, 22, "#ffd23d", 3],
    ]
      .map(
        ([x, y, f, z]) =>
          `<circle cx="${x}" cy="${y}" r="14" fill="${f}"/><circle cx="${x}" cy="${y}" r="7.5" fill="#fff"/><circle cx="${x - 5}" cy="${y - 6}" r="3" fill="#ffffff99"/><text x="${x}" y="${y + 3.5}" font-size="9.5" font-weight="800" text-anchor="middle" fill="#1b1b2c" font-family="sans-serif">${z}</text>`,
      )
      .join("") + stern(55, 14, 5),
  ),
  // Vierblättriger Klee mit Hufeisen
  klee: svg(
    `<path d="M14 52a20 20 0 1 1 36 0" fill="none" stroke="#b9bfcc" stroke-width="7" stroke-linecap="round"/>` +
      [0, 90, 180, 270]
        .map(
          (w) =>
            `<path transform="rotate(${w} 32 30)" d="M32 30c-2-8-12-10-12-3 0 6 8 6 12 3zM32 30c8-2 10-12 3-12-6 0-6 8-3 12z" fill="#2fbf5a" stroke="#15803d" stroke-width="1.2"/>`,
        )
        .join("") +
      `<path d="M32 30q3 10 9 16" stroke="#15803d" stroke-width="3" fill="none" stroke-linecap="round"/>` +
      stern(54, 10, 5),
  ),
  // Tresortür mit Drehrad
  bank: svg(
    `<rect x="8" y="10" width="48" height="44" rx="6" fill="#4b4f63"/><rect x="11" y="13" width="42" height="38" rx="4" fill="#7c8299"/>` +
      `<circle cx="32" cy="32" r="13" fill="#3a3d4f"/><circle cx="32" cy="32" r="9" fill="none" stroke="#ffcf4a" stroke-width="2.5"/>` +
      [0, 60, 120]
        .map(
          (w) =>
            `<path transform="rotate(${w} 32 32)" d="M32 20v24" stroke="#ffcf4a" stroke-width="2.5"/>`,
        )
        .join("") +
      `<circle cx="32" cy="32" r="3" fill="#ffcf4a"/><rect x="50" y="22" width="4" height="20" rx="2" fill="#2b2e3c"/>`,
  ),
  // Lore mit Goldnuggets
  gold: svg(
    `<path d="M10 30h44l-5 18H15z" fill="#7a4a1f" stroke="#4a2b10" stroke-width="2"/><path d="M14 36h36M16 42h32" stroke="#4a2b10" stroke-width="1.5"/>` +
      `<circle cx="20" cy="51" r="5" fill="#3a3d4f"/><circle cx="44" cy="51" r="5" fill="#3a3d4f"/><path d="M4 57h56" stroke="#8a8e9b" stroke-width="2.5"/>` +
      [
        [20, 26, 7],
        [32, 22, 8],
        [44, 26, 7],
        [27, 17, 5],
        [38, 16, 5],
      ]
        .map(
          ([x, y, r]) =>
            `<path d="M${x - r} ${y + 3}l${r * 0.6}-${r} ${r * 0.9} ${r * 0.2} ${r * 0.5} ${r * 0.9}-${r * 0.5} ${r * 0.6}z" fill="#ffcf4a" stroke="#a8740a" stroke-width="1"/>`,
        )
        .join("") +
      stern(55, 9, 5) +
      stern(10, 14, 3.5),
  ),
};

// Rubbelfolie je Los: [Verlauf-Stopps, Glitzer hell, Glitzer dunkel]
export const FOLIE = {
  dreier: [["#c7cad8", "#eef0f7", "#b3b7c8", "#d9dbe6"], "#ffffff88", "#7d82998c"],
  zahlen: [["#b9c6e6", "#eaf0ff", "#9fb0d8", "#cdd8f2"], "#ffffff88", "#5d6fa08c"],
  klee: [["#b8d6c0", "#e9f6ec", "#9cc4a8", "#cfe6d6"], "#ffffff88", "#4f8a608c"],
  bank: [["#8c90a3", "#d5d8e4", "#6f7488", "#a9adbf"], "#ffffff77", "#3a3d4f8c"],
  gold: [["#c9a24a", "#fff0b8", "#b58a2c", "#e6c870"], "#fffbe088", "#8a5a068c"],
};

/** Seriennummer: stabil je Los (wird am Los gemerkt) */
export function serie(karte) {
  if (!karte.serie) {
    const z = new Uint32Array(2);
    crypto.getRandomValues(z);
    const d = new Date();
    karte.serie = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(z[0] % 1e6).padStart(6, "0")}-${String(z[1] % 100).padStart(2, "0")}`;
  }
  return karte.serie;
}

/** Strichcode aus der Seriennummer (nur Deko) */
function strichcode(text) {
  let x = 0,
    teile = "";
  for (const ch of text.replace(/\D/g, "")) {
    const n = Number(ch);
    teile += `<rect x="${x}" y="0" width="${1 + (n % 3)}" height="20"/>`;
    x += 2 + (n % 3) + ((n >> 1) % 2);
    teile += `<rect x="${x}" y="0" width="1" height="20"/>`;
    x += 2 + (n % 2);
  }
  return `<svg class="los-strich" viewBox="0 0 ${x} 20" preserveAspectRatio="none" aria-hidden="true" fill="currentColor">${teile}</svg>`;
}

export function fussBauen(karte, quote) {
  const nr = serie(karte);
  const fuss = document.createElement("div");
  fuss.className = "los-fuss";
  fuss.innerHTML = `${strichcode(nr)}<span class="los-serie"></span><span class="los-kleingedruckt"></span>`;
  fuss.querySelector(".los-serie").textContent = `Nr. ${nr}`;
  fuss.querySelector(".los-kleingedruckt").textContent =
    `Nur Spielgeld – kein Echtgeld, keine Auszahlung. Ausschüttungsquote ${quote.replace(" ", "\u00a0")}. Ergebnis steht beim Kauf fest. Spielen ab 16.`;
  return fuss;
}
