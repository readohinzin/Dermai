/* DermAI : teint de peau choisi par la personne (échelle Monk Skin Tone, 10 teintes). FACULTATIF, ESTIMATION.

   Pourquoi : les repères d'une analyse de peau sont pensés pour des peaux claires. Savoir que la peau est foncée permet d'adapter ce qui peut l'être
   sans inventer de mesure : dire la limite d'une mesure, masquer la mesure de rougeur (une irritation se voit brune, violacée ou grise, pas rouge),
   avertir qu'une irritation ou un bouton peut laisser une tache durable, et introduire plus lentement les soins qui irritent.

   RÈGLES
   - Le choix reste sur l'appareil (localStorage, clé `dermai.skinTone`), comme le pays d'achat : jamais envoyé, ni à Supabase, ni à Perfect Corp, ni
     enregistré dans une analyse ou dans le profil. Le teint peut révéler une origine : donnée sensible, aucune raison de la garder ailleurs.
   - C'est une estimation faite par la personne : l'écran peut fausser les couleurs (phrase affichée avec le choix).
   - Le masquage ne touche JAMAIS les données enregistrées : `view()` renvoie une COPIE pour l'affichage et pour le moteur ; l'historique garde la
     valeur reçue du fournisseur. Rien n'est inventé : une mesure masquée vaut null (« donnée indisponible »).
   - Seuil « teint foncé » : DEEP_FROM, repère éditorial DermAI (teintes 6 à 10), ajustable en une ligne. REDNESS_FOR_DEEP : 'mask' masque la mesure
     de rougeur, 'note' la garde en ajoutant seulement l'avertissement.
   Module partagé navigateur / Node (stockage injecté : testable sans navigateur). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DermaiTone = api; if (typeof document !== 'undefined') api.bind(document, root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'dermai.skinTone';
  /* Monk Skin Tone Scale (Google / Harvard, publiée sous licence ouverte) : les dix teintes de référence. */
  const MONK = [
    { id: 1, hex: '#f6ede4' }, { id: 2, hex: '#f3e7db' }, { id: 3, hex: '#f7ead0' }, { id: 4, hex: '#eadaba' }, { id: 5, hex: '#d7bd96' },
    { id: 6, hex: '#a07e56' }, { id: 7, hex: '#825c43' }, { id: 8, hex: '#604134' }, { id: 9, hex: '#3a312a' }, { id: 10, hex: '#292420' }
  ];
  const DEEP_FROM = 6;
  const REDNESS_FOR_DEEP = 'mask';   // 'mask' | 'note'

  const TEXT = {
    title: 'Mon teint de peau',
    hint: 'Facultatif. Touchez la pastille la plus proche de la peau de votre visage, à la lumière du jour.',
    estimate: 'C\'est une estimation : l\'écran de votre téléphone peut fausser les couleurs.',
    privacy: 'Ce choix reste sur votre appareil. DermAI ne l\'envoie à personne : il sert seulement à adapter les textes et les alertes.',
    chosen: n => 'Teint ' + n + ' sur 10 choisi.',
    unset: 'Aucun teint choisi.',
    clear: 'Retirer mon choix',
    swatch: n => 'Teint ' + n + ' sur 10',
    alertTitle: 'Pour votre teint',
    alert: 'Sur une peau foncée, un bouton ou une irritation peut laisser une tache qui met longtemps à partir. Introduisez les soins un par un, ne grattez pas et ne percez pas les boutons, et protégez votre peau du soleil chaque matin : il fonce les marques.',
    maskedTitle: 'Rougeurs non affichées',
    masked: 'Pour un teint foncé, la mesure de rougeur est peu fiable : une irritation se voit plutôt brune, violacée ou grise. DermAI préfère ne pas l\'afficher plutôt que de vous donner un chiffre qui peut tromper.',
    maskedLink: 'Changer mon teint'
  };

  const isTone = v => Number.isInteger(v) && v >= 1 && v <= 10;
  const isDeep = t => isTone(t) && t >= DEEP_FROM;
  const maskRedness = t => isDeep(t) && REDNESS_FOR_DEEP === 'mask';
  const marks = t => isDeep(t);                       // « peau qui marque » : lu par le moteur (introduction plus lente des soins qui irritent)

  const browserStore = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };
  function read(storage) {
    try { const n = Number(storage && storage.getItem(KEY)); return isTone(n) ? n : null; } catch (e) { return null; }
  }
  /* Enregistre (1 à 10) ou efface (null). Renvoie vrai si le navigateur a accepté. */
  function write(storage, tone) {
    try {
      if (!storage) return false;
      if (tone == null) { storage.removeItem(KEY); return true; }
      if (!isTone(tone)) return false;
      storage.setItem(KEY, String(tone)); return true;
    } catch (e) { return false; }
  }
  let session = null;                                 // le choix vaut pour la visite si le stockage est refusé
  const get = storage => { const s = storage === undefined ? browserStore() : storage; const v = read(s); return v !== null ? v : session; };
  function set(tone, storage) {
    session = tone == null ? null : isTone(tone) ? tone : session;
    return write(storage === undefined ? browserStore() : storage, tone);
  }

  /* Type de peau sans sa composante « rougeurs » (« Dry & Redness » devient « Dry » ; « Redness » seul devient inconnu) : même source, rien d'inventé. */
  function stripRedness(v) {
    if (typeof v !== 'string') return v;
    const k = v.trim().replace(/\s+/g, ' ').toLowerCase();
    if (k === 'redness') return null;
    const m = /^(dry|oily|combination) & redness$/.exec(k);
    return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : v;
  }
  /* Autres raisons de masquer une mesure (confiance, js/confidence.js) : des fonctions (normalized, teint) -> identifiants de mesures à masquer. */
  const maskers = [];
  const addMasker = fn => { if (typeof fn === 'function') maskers.push(fn); };
  /* COPIE de `normalized` pour l'affichage et le moteur. La donnée enregistrée n'est jamais modifiée. Sans masquage : le même objet. */
  function view(normalized, tone) {
    const t = tone === undefined ? get() : tone;
    if (normalized === null || typeof normalized !== 'object') return normalized;
    const ids = new Set();
    if (maskRedness(t)) ids.add('redness');
    for (const m of maskers) { try { for (const id of (m(normalized, t) || [])) ids.add(id); } catch (e) { /* un masqueur défaillant ne masque rien */ } }
    if (!ids.size) return normalized;
    const out = Object.assign({}, normalized);
    for (const id of ids) if (id === 'redness' || (out[id] !== null && typeof out[id] === 'object')) out[id] = { rawScore: null, uiScore: null };
    if (ids.has('redness') && normalized.skinType && typeof normalized.skinType === 'object') {
      const s = normalized.skinType;
      out.skinType = { whole: stripRedness(s.whole), tZone: stripRedness(s.tZone), uZone: stripRedness(s.uZone) };
    }
    return out;
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
  /* Couleur du numéro lisible sur la pastille (luminance relative). */
  const rel = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const x = rel(a), y = rel(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const INK_DARK = '#140d08', INK_LIGHT = '#ffffff';
  const inkOn = hex => (contrast(hex, INK_DARK) >= contrast(hex, INK_LIGHT) ? INK_DARK : INK_LIGHT);   // le plus fort contraste des deux (au moins 4,5 pour 1 sur les dix teintes)

  /* Sélecteur : dix pastilles (groupe de boutons radio), phrase d'estimation, mention de confidentialité. Géré par bind() : aucun état dans l'application. */
  function picker(tone) {
    const t = tone === undefined ? get() : tone;
    const sw = MONK.map(m => '<button type="button" class="c-tone__swatch" role="radio" aria-checked="' + (t === m.id) + '" data-tone="' + m.id + '" aria-label="' + TEXT.swatch(m.id) +
      '" style="--tone:' + m.hex + ';--tone-ink:' + inkOn(m.hex) + '"><span>' + m.id + '</span></button>').join('');
    return '<section class="c-tone" data-tone-picker aria-labelledby="tone-title"><h2 class="h3" id="tone-title">' + TEXT.title + '</h2>' +
      '<p class="muted">' + TEXT.hint + '</p><div class="c-tone__row" role="radiogroup" aria-label="' + TEXT.title + '">' + sw + '</div>' +
      '<p class="c-tone__status" role="status" aria-live="polite" data-tone-status>' + (t ? TEXT.chosen(t) : TEXT.unset) + '</p>' +
      '<p class="c-disclaimer">' + TEXT.estimate + ' ' + TEXT.privacy + '</p>' +
      '<button type="button" class="link" data-tone-clear' + (t ? '' : ' hidden') + '>' + TEXT.clear + '</button></section>';
  }

  /* Avertissement pour les teints foncés (texte seul : « peau qui marque »). '' sinon. */
  const alertHtml = tone => {
    const t = tone === undefined ? get() : tone;
    return isDeep(t) ? '<div class="c-notice u-my-5" data-tone-alert><div><span class="c-notice__title">' + TEXT.alertTitle + '</span>' + esc(TEXT.alert) + '</div></div>' : '';
  };
  /* Rougeurs masquées : dit pourquoi la ligne est indisponible, avec un lien vers le profil. '' sinon. */
  const maskedHtml = tone => {
    const t = tone === undefined ? get() : tone;
    return maskRedness(t) ? '<div class="c-notice u-my-5" data-redness-masked><div><span class="c-notice__title">' + TEXT.maskedTitle + '</span>' + esc(TEXT.masked) +
      ' <button type="button" class="link" data-go="profile">' + TEXT.maskedLink + '</button></div></div>' : '';
  };

  /* Écoute unique et autonome : le sélecteur se met à jour sur place, sans redessiner l'application. */
  function bind(doc, win) {
    if (!doc || !doc.addEventListener || doc.__dermaiToneBound) return;
    doc.__dermaiToneBound = true;
    doc.addEventListener('click', ev => {
      const el = ev.target && ev.target.closest ? ev.target.closest('[data-tone], [data-tone-clear]') : null;
      if (!el) return;
      const root = el.closest('[data-tone-picker]');
      const tone = el.hasAttribute('data-tone-clear') ? null : Number(el.getAttribute('data-tone'));
      set(tone);
      if (!root) return;
      root.querySelectorAll('[data-tone]').forEach(b => b.setAttribute('aria-checked', String(Number(b.getAttribute('data-tone')) === tone)));
      const st = root.querySelector('[data-tone-status]'); if (st) st.textContent = tone ? TEXT.chosen(tone) : TEXT.unset;
      const cl = root.querySelector('[data-tone-clear]'); if (cl) cl.hidden = !tone;
    });
  }

  return { contrast, inkOn, KEY, MONK, DEEP_FROM, REDNESS_FOR_DEEP, TEXT, isTone, isDeep, maskRedness, marks, read, write, get, set, addMasker, view, stripRedness, picker, alertHtml, maskedHtml, bind };
});
