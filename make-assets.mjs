// Rasterises the two images that cannot be SVG: the apple touch icon and the
// link-preview card. Run with `npm run assets` after changing either source below.
import sharp from "sharp";
import { readFileSync } from "node:fs";

const ink = "#080d18";
const text = "#c9d3e3";
const dim = "#7e8da8";
const accent = "#e8b04b";

const mono = "IBM Plex Mono, DejaVu Sans Mono, monospace";
const serif = "Source Serif 4, DejaVu Serif, Georgia, serif";

const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${ink}"/>
  <rect x="0" y="0" width="1200" height="630" fill="none" stroke="#1e2a3f" stroke-width="2"/>
  <line x1="80" y1="150" x2="1120" y2="150" stroke="#1e2a3f" stroke-width="1"/>
  <line x1="80" y1="470" x2="1120" y2="470" stroke="#1e2a3f" stroke-width="1"/>
  <rect x="80" y="112" width="34" height="3" fill="${accent}"/>
  <text x="80" y="100" font-family="${mono}" font-size="26" font-weight="600" fill="${text}">Amir Balazade</text>
  <text x="80" y="230" font-family="${serif}" font-size="62" fill="${text}">I build the screens where</text>
  <text x="80" y="302" font-family="${serif}" font-size="62" fill="${text}">a wrong number is noticed</text>
  <text x="80" y="374" font-family="${serif}" font-size="62" fill="${text}">in seconds.</text>
  <text x="80" y="530" font-family="${mono}" font-size="24" fill="${dim}">Front-end engineer</text>
  <text x="80" y="566" font-family="${mono}" font-size="24" fill="${dim}">Angular, TypeScript, fintech and web3</text>
  <text x="1120" y="566" font-family="${mono}" font-size="24" fill="${dim}" text-anchor="end">amirbalazade.ir</text>
</svg>`;

await sharp(Buffer.from(card)).png().toFile("public/og.png");

await sharp(readFileSync("public/favicon.svg"), { density: 384 })
  .resize(180, 180)
  .png()
  .toFile("public/apple-touch-icon.png");

console.log("wrote public/og.png and public/apple-touch-icon.png");
