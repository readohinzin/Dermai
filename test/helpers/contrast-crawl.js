'use strict';
/* Parcours de contraste exécuté DANS la page (page.evaluate) : pour chaque texte visible, couleur du texte contre le fond réellement placé dessous (éléments empilés, frères compris ;
   dégradés : pire arrêt ; images : ignorées et comptées à part). Texte normal : 4,5 pour 1 ; grand texte (24 px, ou 18,66 px gras) : 3 pour 1. Les contrôles désactivés sont exemptés (WCAG).
   Limite : les fonds dessinés par ::before et ::after ne sont pas lus ; leurs cas sont couverts par les jetons (test/contrast.test.js, CT4). */
function crawlFn() {
  const parse = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }; return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const stops = img => { const out = []; const re = /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b)/g; let m; const tmp = document.createElement('span'); document.body.appendChild(tmp); while ((m = re.exec(img))) { tmp.style.color = m[1]; const c = parse(getComputedStyle(tmp).color); if (c) out.push(c); } tmp.remove(); return out; };
  const layerOf = n => { const cs = getComputedStyle(n); const bc = parse(cs.backgroundColor); const img = cs.backgroundImage; let grad = null, unknown = false; if (img && img !== 'none') { if (/gradient/.test(img)) grad = stops(img); else unknown = true; } return { node: n, color: bc && bc.a > 0 ? bc : null, grad: grad && grad.length ? grad : null, unknown, opacity: parseFloat(cs.opacity) }; };
  /* fonds situés SOUS le texte, au point donné : éléments empilés (frères et ancêtres), du plus proche au plus lointain, jusqu'à un fond opaque */
  const bgLayers = (el, x, y) => { const stack = document.elementsFromPoint(x, y); let i = stack.findIndex(n => n === el || el.contains(n) === false && n.contains(el)); if (i < 0) i = 0; const layers = [];
    for (const n of stack.slice(i)) { if (n.tagName === 'IMG' || n.tagName === 'VIDEO' || n.tagName === 'CANVAS') { layers.push({ unknown: true }); break; } const l = layerOf(n); layers.push(l); if (l.color && l.color.a >= 1 && !l.grad && !l.unknown) break; }
    return layers; };
  const effOpacity = el => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
  const out = [];
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'CANVAS', 'OPTION']);
  const base = { r: parse(getComputedStyle(document.documentElement).backgroundColor) ? 0 : 0 };
  const rootBg = (() => { const c = parse(getComputedStyle(document.body).backgroundColor); const h = parse(getComputedStyle(document.documentElement).backgroundColor); return (c && c.a > 0 ? c : h && h.a > 0 ? h : { r: 255, g: 255, b: 255, a: 1 }); })();
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (skip.has(el.tagName.toUpperCase()) || el.closest('svg, [aria-hidden="true"], .sr, script, style')) continue;
    const texts = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length);
    if (!texts.length) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const rect = el.getBoundingClientRect(); if (rect.width < 2 || rect.height < 2) continue;
    if (el.closest('[disabled], [aria-disabled="true"]')) continue;
    if (el.closest('.hc-b')) continue;   // bulles de la bannière : disque blanc dessiné par ::after, couleurs vérifiées par les jetons (CT4)
    const eo = effOpacity(el); if (eo < 0.05) continue;
    let fg = parse(cs.color); if (!fg) continue; fg = { ...fg, a: fg.a * eo };
    const pts = [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]].map(([fx, fy]) => [rect.left + rect.width * fx, rect.top + rect.height * fy]).filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
    if (!pts.length) continue;
    const perPoint = pts.map(([x, y]) => bgLayers(el, x, y)); if (perPoint.every(L => L.some(l => l.unknown))) { out.push({ skip: 'image' }); continue; }
    const layersList = perPoint.filter(L => !L.some(l => l.unknown));
    let cands = [];
    for (const layers of layersList) { let cs0 = [rootBg]; for (const l of layers.slice().reverse()) { const nx = []; for (const c of cs0) { if (l.grad) for (const g of l.grad) nx.push(over(g, c)); else if (l.color) nx.push(over(l.color, c)); else nx.push(c); } cs0 = nx.slice(0, 12); } cands = cands.concat(cs0); }
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700, large = size >= 24 || (size >= 18.66 && bold);
    let worst = 99, worstBg = null;
    for (const bg of cands) { const f = over(fg, bg); const r = ratio({ r: f.r, g: f.g, b: f.b }, { r: bg.r, g: bg.g, b: bg.b }); if (r < worst) { worst = r; worstBg = bg; } }
    const need = large ? 3 : 4.5;
    if (worst < need) { const path = []; for (let n = el, i = 0; n && n.nodeType === 1 && i < 3; n = n.parentElement, i++) path.push(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/)[0] : '')); out.push({ ratio: Math.round(worst * 100) / 100, need, fg: cs.color, bg: worstBg ? `rgb(${Math.round(worstBg.r)},${Math.round(worstBg.g)},${Math.round(worstBg.b)})` : '?', t: texts[0].textContent.trim().slice(0, 50), path: path.join(' < ') }); }
  }
  return out;
}

module.exports = { fn: crawlFn };
