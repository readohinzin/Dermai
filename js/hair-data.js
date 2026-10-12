/* Studio Beauté, volet capillaire : données de l'interface (onglets, fonctions, palettes de couleur, libellés) et conversion de la sélection en configuration pour le serveur.
   Module partagé navigateur / Node : fonctions pures, aucun réseau. Les valeurs acceptées (presets de couleur, plages 0 à 100, couleurs #RRGGBB) sont celles du schéma officiel
   (outils « AI-Hair-Color-Virtual-Try-On », « AI-Hair-Style-Virtual-Try-On »… du dépôt YouCam-API/beauty-skin-care-mcp) telles que reprises dans server/hair.js (un test vérifie que
   chaque valeur proposée ici est acceptée par le serveur).

   Les modèles de coiffure, d'extensions, de franges, d'ondulations et de volume ne sont PAS écrits ici : ils viennent de la liste officielle du fournisseur (aucun identifiant n'est inventé).
   Les noms de couleurs sont des repères de lecture : seuls les 20 presets du fournisseur portent le nom exact envoyé (preset) ; les autres teintes sont envoyées comme couleur personnalisée. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiHairData = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Onglets du Studio (après « Maquillage ») : « Boucles et volume » regroupe deux fonctions du fournisseur (ondulations, volume). Chaque fonction garde son contrat et ses unités. */
  const TABS = [
    { id: 'hairstyle', label: 'Coiffures et perruques', features: ['hairstyle'] },
    { id: 'haircolor', label: 'Couleurs de cheveux', features: ['haircolor'] },
    { id: 'extensions', label: 'Extensions', features: ['extensions'] },
    { id: 'bangs', label: 'Franges', features: ['bangs'] },
    { id: 'curls', label: 'Boucles et volume', features: ['wavy', 'volume'] }
  ];

  /* Nature de la transformation : jamais présentée comme une autre (une extension n'est pas une perruque, le volume n'est pas un diagnostic). */
  const FEATURES = {
    hairstyle: { label: 'Coiffure', kind: 'Coiffure complète', units: 2,
      about: 'Remplace votre coiffure par le style choisi : un modèle de la liste ou la photo d\'une coiffure que vous aimez.',
      limit: 'Aperçu virtuel d\'un STYLE de coiffure. Ce n\'est pas l\'essai d\'un modèle précis de perruque du commerce : sa matière, sa densité et sa couleur réelles peuvent différer.' },
    haircolor: { label: 'Couleur', kind: 'Coloration', units: 1,
      about: 'Change la couleur de vos cheveux, en une teinte ou en dégradé (ombré).',
      limit: 'Aperçu de couleur généré par ordinateur. Le résultat réel dépend de votre couleur de départ : éclaircir demande une décoloration, voyez un coiffeur.' },
    extensions: { label: 'Extensions', kind: 'Extensions (longueur ajoutée)', units: 1,
      about: 'Ajoute de la longueur à vos cheveux, fondue avec votre longueur actuelle. Pensée pour les cheveux longs ou très longs.',
      limit: 'Des extensions ne remplacent pas votre coiffure : ce n\'est pas l\'essai d\'une perruque complète (voyez « Coiffures et perruques »).' },
    bangs: { label: 'Franges', kind: 'Franges', units: 1,
      about: 'Ajoute une frange à votre coiffure actuelle.',
      limit: 'Aperçu de frange. La tenue réelle dépend de la texture et de la pousse de vos cheveux.' },
    wavy: { label: 'Boucles et ondulations', kind: 'Boucles et ondulations', units: 1,
      about: 'Donne à vos cheveux des ondulations ou des boucles, selon les modèles proposés.',
      limit: 'Aperçu de boucles. Le catalogue du fournisseur ne couvre pas forcément toutes les textures ni tous les styles afro : regardez les modèles proposés.' },
    volume: { label: 'Volume', kind: 'Volume capillaire', units: 2,
      about: 'Donne plus de volume à vos cheveux sur la photo.',
      limit: 'Aperçu esthétique seulement : ce n\'est ni un diagnostic de chute de cheveux ni une solution médicale.' }
  };
  const FEATURE_IDS = Object.keys(FEATURES);

  /* Presets officiels (noms EXACTS envoyés) avec leur libellé français et une couleur d'affichage approximative (jamais envoyée). */
  const PRESETS_FULL = [
    ['Jet Black', 'Noir naturel', '#15110f'], ['Chocolate Brown', 'Brun chocolat', '#3b2417'], ['Honey Blonde', 'Blond miel', '#c99a3c'], ['Platinum Blonde', 'Blond platine', '#e6dcc4'],
    ['Ash Gray', 'Gris cendré', '#9a9a9a'], ['Rose Gold', 'Rose doré', '#c98b85'], ['Burgundy', 'Bordeaux', '#5e1424'], ['Copper Red', 'Rouge cuivré', '#b5683a'],
    ['Lavender', 'Lavande', '#a99ac9'], ['Teal Blue', 'Bleu canard', '#1f6a78']
  ];
  const PRESETS_OMBRE = [
    ['Dark Brown/Caramel Blonde', 'Brun foncé / blond caramel', ['#3b2417', '#b88a4a']], ['Jet Black/Silver Gray', 'Noir / gris argenté', ['#15110f', '#b4b4b4']],
    ['Ash Brown/Lavender', 'Brun cendré / lavande', ['#5b4a42', '#a99ac9']], ['Rose Gold/Peach Blonde', 'Rose doré / blond pêche', ['#c98b85', '#e8c39a']],
    ['Burgundy/Magenta Pink', 'Bordeaux / rose magenta', ['#5e1424', '#c2347a']], ['Deep Blue/Teal Green', 'Bleu profond / vert canard', ['#1b2a5a', '#1f6a78']],
    ['Plum Purple/Pastel Lilac', 'Prune / lilas pastel', ['#4a1f3d', '#cbb6e0']], ['Copper Red/Golden Blonde', 'Rouge cuivré / blond doré', ['#b5683a', '#d9b25f']],
    ['Dark Gray/Ice Blonde', 'Gris foncé / blond glacé', ['#4a4a4a', '#e9e3d3']], ['Midnight Blue/Denim Blue', 'Bleu nuit / bleu jean', ['#141c3a', '#4a6a9a']]
  ];
  /* Teintes personnalisées (couleur libre envoyée dans une palette) : naturelles d'abord, fantaisie ensuite. Nommées pour la lecture, pas des références de produit. */
  const CUSTOM = [
    ['Noir naturel', '#1c1410'], ['Brun très foncé', '#2b1b12'], ['Brun chocolat', '#3b2417'], ['Brun acajou', '#5a2a1f'], ['Bordeaux', '#5e1424'], ['Châtain', '#6b4a33'],
    ['Cuivre', '#b5683a'], ['Caramel', '#a8672d'], ['Miel', '#c99a3c'], ['Blond doré', '#d9b25f'], ['Blond cendré', '#b9a98a'], ['Gris argenté', '#9a9a9a'],
    ['Violet', '#6b3a8a'], ['Bleu', '#2a4a9a'], ['Rose', '#d9798f'], ['Rouge vif', '#c21e3a']
  ];
  const TEXT = {
    haircolorMode: [['preset', 'Teintes prêtes'], ['full', 'Couleur personnalisée'], ['ombre', 'Dégradé personnalisé']]
  };

  const HEX = /^#[0-9a-fA-F]{6}$/;
  const int100 = v => Number.isInteger(v) && v >= 0 && v <= 100;
  const clone = o => JSON.parse(JSON.stringify(o));

  /* Sélection par défaut de chaque fonction (rien d'envoyé tant que l'utilisatrice n'a pas lancé l'essai). */
  const DEFAULTS = {
    hairstyle: { mode: 'template', templateId: '', hairColor: 'ref' },
    haircolor: { mode: 'preset', preset: 'Chocolate Brown', color: '#3b2417', colorIntensity: 70, shineIntensity: 40, color2: '#c99a3c', blend: 50, offset: 0.2 },
    extensions: { templateId: '' }, bangs: { templateId: '' }, wavy: { templateId: '' }, volume: { templateId: '' }
  };
  const fresh = id => clone(DEFAULTS[id] || {});

  /* Sélection de l'interface → configuration envoyée au serveur ; null si la sélection est incomplète (aucun envoi possible). */
  function toConfig(id, sel) {
    const s = sel || {};
    if (id === 'haircolor') {
      if (s.mode === 'preset') return PRESETS_FULL.concat(PRESETS_OMBRE).some(p => p[0] === s.preset) ? { v: 1, preset: s.preset } : null;
      const pal = (color, extra) => Object.assign({ color: String(color).toLowerCase() }, extra || {});
      if (!HEX.test(s.color || '')) return null;
      if (s.mode === 'full') return { v: 1, pattern: { name: 'full' }, palettes: [pal(s.color, { color_intensity: s.colorIntensity, shine_intensity: s.shineIntensity })] };
      if (s.mode === 'ombre') return HEX.test(s.color2 || '') ? { v: 1, pattern: { name: 'ombre', blend_strength: s.blend, line_offset: s.offset, coloring_section: 'top' }, palettes: [pal(s.color), pal(s.color2)] } : null;
      return null;
    }
    if (id === 'hairstyle') {
      if (s.mode === 'reference') return { v: 1, reference: true };
      return s.templateId ? { v: 1, template: s.hairColor === 'src' || s.hairColor === 'ref' ? { id: s.templateId, hair_color: s.hairColor } : { id: s.templateId } } : null;
    }
    return FEATURES[id] && s.templateId ? { v: 1, template: { id: s.templateId } } : null;
  }

  /* Sélection relue depuis le stockage (favoris) : tout ce qui est invalide retombe sur la valeur par défaut, jamais d'erreur. */
  function sanitizeSelection(id, raw) {
    const out = fresh(id);
    if (!raw || typeof raw !== 'object' || !FEATURES[id]) return out;
    const tid = v => typeof v === 'string' && /^[A-Za-z0-9_.:+=-]{1,120}$/.test(v) ? v : '';
    if (id === 'haircolor') {
      if (['preset', 'full', 'ombre'].includes(raw.mode)) out.mode = raw.mode;
      if (PRESETS_FULL.concat(PRESETS_OMBRE).some(p => p[0] === raw.preset)) out.preset = raw.preset;
      for (const k of ['color', 'color2']) if (typeof raw[k] === 'string' && HEX.test(raw[k])) out[k] = raw[k].toLowerCase();
      for (const k of ['colorIntensity', 'shineIntensity', 'blend']) if (int100(raw[k])) out[k] = raw[k];
      if (typeof raw.offset === 'number' && Number.isFinite(raw.offset) && raw.offset >= -0.99 && raw.offset <= 0.99) out.offset = raw.offset;
    } else if (id === 'hairstyle') {
      out.templateId = tid(raw.templateId); if (raw.hairColor === 'src' || raw.hairColor === 'ref') out.hairColor = raw.hairColor;
      out.mode = raw.mode === 'reference' ? 'reference' : 'template';
    } else out.templateId = tid(raw.templateId);
    return out;
  }
  const presetLabel = name => { const hit = PRESETS_FULL.find(p => p[0] === name) || PRESETS_OMBRE.find(p => p[0] === name); return hit ? hit[1] : ''; };
  const unitsText = n => `${n} unité${n > 1 ? 's' : ''}`;

  return { TABS, FEATURES, FEATURE_IDS, PRESETS_FULL, PRESETS_OMBRE, CUSTOM, TEXT, DEFAULTS, fresh, toConfig, sanitizeSelection, presetLabel, unitsText };
});
