/* Couche INTERPRÉTATION : normalized → signaux interprétables. Aucun score secondaire n'est créé : le score de chaque indicateur est
   son uiScore tel qu'affiché (SkinModel.displayScore), la bande vient de SkinModel.scoreBand. rawScore n'est jamais lu.
   Les domaines regroupent et expliquent ; ils n'ont pas de score. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const dep = isNode
    ? { skin: require('../skin-model.js'), data: require('./data/indicators.js') }
    : { skin: root.SkinModel, data: (root.DermaiEngine || {}).indicatorsData };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.interpret = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const skin = dep.skin, data = dep.data;

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const BASES = ['normal', 'oily', 'dry', 'combination'];

  /* Type de peau (région whole seulement). Valeur inconnue : null, rien d'inventé. */
  function parseSkinType(whole) {
    const key = skin.skinTypeKey(whole);
    const label = skin.SKIN_TYPE_LABELS[key];
    if (!label) return null;
    const base = BASES.find(b => key === b || key.startsWith(b + ' ')) || null;
    return { key, label, base, redness: key.includes('redness') };
  }

  const view = v => { const score = skin.displayScore(v), band = skin.scoreBand(v); return { score, band: band ? band.key : null, bandLabel: band ? band.label : null }; };

  function interpret(normalized) {
    const n = isObj(normalized) ? normalized : {};
    const indicators = skin.METRIC_KEYS.map((id, order) => {
      const meta = data.INDICATORS[id], v = view(isObj(n[id]) ? n[id].uiScore : null);
      return { id, order, label: skin.METRIC_LABELS[id], score: v.score, band: v.band, bandLabel: v.bandLabel, available: v.score !== null,
        domain: meta.domain, actionability: meta.actionability, confidence: meta.confidence };
    });
    const skinType = isObj(n.skinType) ? parseSkinType(n.skinType.whole) : null;
    const redness = indicators.find(i => i.id === 'redness');
    /* Mode confort / prudence : type de peau « Redness » ou indicateur rougeurs « À surveiller ». Ce n'est pas un diagnostic de sensibilité. */
    const comfortReasons = [];
    if (skinType && skinType.redness) comfortReasons.push('skin_type_redness');
    if (redness.band === 'low') comfortReasons.push('redness_low');
    return {
      indicators,
      skinType,
      skinAge: skin.displayAge(n.skinAge),            // informatif seulement : jamais utilisé par le moteur
      global: view(n.globalScore),                    // contexte seulement : jamais recalculé, jamais une priorité
      context: { comfortMode: comfortReasons.length > 0, comfortReasons, skinBase: skinType ? skinType.base : null }
    };
  }

  return { interpret, parseSkinType };
});
