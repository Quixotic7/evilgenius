/* SPDX-License-Identifier: MPL-2.0
 * EvilGenius's site: the firmware's pixel kit in the browser. Two elements, drawn on canvases from the firmware's own
 * art (pxart.js: tools/eg/gen_site_art.py):
 *
 *   <px-text font="big|small" scale="3" color="lightblue" shadow="blue">EVIL GENIUS</px-text>
 *   <px-sprite name="GENIUS" scale="4" flip></px-sprite>
 *
 * A colour is one of the C64's sixteen by name (white, lightblue, yellow ..) or an index 0..15. The text stays in the
 * page for readers and search (the canvas is aria-hidden; the element's own text is kept, visually hidden). Lower
 * case is drawn upper case, as on the unit. */
import { PXART } from "./pxart.js";

const PAL = PXART.pal;
export function colour(c, fallback = 1) {
  if (c == null || c === "") return PAL[fallback];
  const i = PXART.names.indexOf(String(c).toLowerCase());
  if (i >= 0) return PAL[i];
  const n = Number(c);
  return Number.isInteger(n) && n >= 0 && n < 16 ? PAL[n] : PAL[fallback];
}

/* a canvas whose pixels stay pixels, w x h art pixels at scale */
function canvas(w, h, scale) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  c.style.width = c.width * scale + "px";
  c.style.height = c.height * scale + "px";
  c.style.imageRendering = "pixelated";
  c.setAttribute("aria-hidden", "true");
  return c;
}

export function textWidth(s, font) {
  return s.length ? s.length * font.cw - 1 : 0;
}

/* s at x, y on ctx (art pixels), in col; returns the x after it */
export function drawText(ctx, x, y, s, col, font) {
  ctx.fillStyle = col;
  for (const ch0 of s) {
    const ch = ch0.toUpperCase();
    const g = font.g[ch] || font.g[ch0];
    if (g) {
      for (let j = 0; j < g.length; j++) {
        const row = g[j];
        for (let i = 0; i < row.length; i++) {
          if (row[i] !== "1") continue;
          let n = 1;                                   // (a run of lit pixels: one rectangle, as px.c)
          while (i + n < row.length && row[i + n] === "1") n++;
          ctx.fillRect(x + i, y + j, n, 1);
          i += n - 1;
        }
      }
    }
    x += font.cw;
  }
  return x;
}

export function drawSprite(ctx, x, y, name, flip = false, tint = null) {
  const rows = PXART.spr[name];
  if (!rows) return;
  for (let j = 0; j < rows.length; j++) {
    const row = flip ? [...rows[j]].reverse().join("") : rows[j];
    for (let i = 0; i < row.length; i++) {
      if (row[i] === ".") continue;
      ctx.fillStyle = tint || PAL[parseInt(row[i], 16)];
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
}

class PxText extends HTMLElement {
  static get observedAttributes() { return ["font", "scale", "color", "shadow"]; }
  connectedCallback() {
    if (!this._text) {
      this._text = this.textContent.trim().replace(/\s+/g, " ");
      const sr = document.createElement("span");
      sr.className = "px-sr";
      sr.textContent = this._text;
      this.textContent = "";
      this.append(sr);
    }
    this.render();
  }
  attributeChangedCallback() { if (this._text) this.render(); }
  set text(s) {
    this._text = String(s);
    const sr = this.querySelector(".px-sr");
    if (sr) sr.textContent = this._text;
    this.render();
  }
  get text() { return this._text || ""; }
  render() {
    const font = this.getAttribute("font") === "small" ? PXART.small : PXART.big;
    const scale = Math.max(1, Number(this.getAttribute("scale")) || 2);
    const shadow = this.getAttribute("shadow");
    const pad = shadow ? 1 : 0;
    const c = canvas(textWidth(this._text, font) + pad, font.ch - 1 + pad, scale);
    const ctx = c.getContext("2d");
    if (shadow) drawText(ctx, 1, 1, this._text, colour(shadow, 6), font);
    drawText(ctx, 0, 0, this._text, colour(this.getAttribute("color"), 1), font);
    this.querySelector("canvas")?.remove();
    this.append(c);
  }
}

class PxSprite extends HTMLElement {
  static get observedAttributes() { return ["name", "scale", "flip", "tint"]; }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  render() {
    const rows = PXART.spr[this.getAttribute("name")];
    this.textContent = "";
    if (!rows) return;
    const scale = Math.max(1, Number(this.getAttribute("scale")) || 2);
    const c = canvas(rows[0].length, rows.length, scale);
    const tint = this.getAttribute("tint");
    drawSprite(c.getContext("2d"), 0, 0, this.getAttribute("name"), this.hasAttribute("flip"), tint ? colour(tint) : null);
    this.append(c);
  }
}

if (!customElements.get("px-text")) customElements.define("px-text", PxText);
if (!customElements.get("px-sprite")) customElements.define("px-sprite", PxSprite);
export { PXART };
