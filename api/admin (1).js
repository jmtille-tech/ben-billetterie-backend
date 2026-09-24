// api/admin.js
// Endpoint interne (réservé à Jean-Marc) pour consulter et valider les entretiens BEN Billetterie.
// Protégé par un mot de passe partagé (ADMIN_PASSWORD, en variable d'environnement).
// Utilise la clé Supabase service_role (SUPABASE_SERVICE_ROLE_KEY), qui contourne la RLS —
// cette clé ne quitte jamais le serveur.

async function supabaseRequest(path, options) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Variables Supabase manquantes côté serveur (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  const response = await fetch(SUPABASE_URL + path, Object.assign({
    headers: Object.assign({
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json'
    }, (options && options.headers) || {})
  }, options || {}));
  if (!response.ok) {
    const errText = await response.text();
    throw new Error('Erreur Supabase (' + response.status + ') : ' + errText);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// --- Moteur de scoring (vertical zoo) ---------------------------------------
// Filtre les opérateurs (table solutions) sur les prérequis, puis les classe
// sur une grille de critères pondérés. Les colonnes de solutions sont stockées
// en texte ("true"/"false" pour les booléens, nombres avec espaces pour les
// jauges) — on normalise ici avant de calculer.

function toBool(v) {
  if (v === null || v === undefined) return false;
  return String(v).trim().toLowerCase() === 'true';
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const cleaned = String(v).replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

function containsLang(v, lang) {
  if (!v) return false;
  return String(v).toLowerCase().indexOf(lang.toLowerCase()) !== -1;
}

const ZOO_SECTEUR_LABEL = 'Zoos & parcs animaliers';

// Étage 1 — prérequis binaires. Retourne { pass: bool, reasons: [] } (reasons
// listées seulement quand ça échoue, pour comprendre une exclusion).
function passesPrerequis(solution, data) {
  const reasons = [];

  const secteurOk =
    solution.secteur_principal === ZOO_SECTEUR_LABEL ||
    containsLang(solution.secteurs_secondaires, ZOO_SECTEUR_LABEL);
  if (!secteurOk) reasons.push('secteur non couvert');

  const volume = data && data.volumetrie ? data.volumetrie.volume_billets_annuel : null;
  if (volume !== null && volume !== undefined) {
    const jmin = toNumber(solution.jauge_min);
    const jmax = toNumber(solution.jauge_max);
    if (jmin !== null && volume < jmin) reasons.push('volume trop faible pour cet opérateur');
    if (jmax !== null && volume > jmax) reasons.push('volume trop élevé pour cet opérateur');
  }

  const besoins = (data && data.besoins_confirmes) || {};
  if (besoins.otas && besoins.otas.confirme === true && !toBool(solution.otas)) {
    reasons.push("pas d'OTA alors que requis");
  }
  if (besoins.cashless && besoins.cashless.confirme === true && !toBool(solution.cashless)) {
    reasons.push('pas de cashless alors que requis');
  }

  return { pass: reasons.length === 0, reasons: reasons };
}

// Étage 2 — score pondéré parmi les survivants du filtre.
function computeScore(solution, data) {
  const besoins = (data && data.besoins_confirmes) || {};
  let score = 0;
  const detail = [];

  function add(label, weight, value) {
    const points = value ? weight : 0;
    score += points;
    detail.push({ label: label, weight: weight, obtained: !!value, points: points });
  }

  add('Contrôle d\'accès', 3, toBool(solution.controle_acces));
  add('Caisse certifiée', 3, toBool(solution.caisse_certifiee));
  add('Gestion groupes', 3, toBool(solution.gestion_groupes));
  add('Gestion CSE', 3, toBool(solution.gestion_cse));
  add('Tarification dynamique', 3, toBool(solution.tarification_dynamique));

  const integrationsSi = besoins.integrations_si || {};
  const integrationWeight = (integrationsSi.logiciels_a_connecter && integrationsSi.logiciels_a_connecter.length > 0) ? 3 : 2;
  add('Intégration logiciels', integrationWeight, toBool(solution.integration_logiciels));

  const crmWeight = integrationsSi.crm_existant === true ? 3 : 2;
  add('CRM intégré', crmWeight, toBool(solution.crm_integre));

  const apiWeight = (besoins.otas && besoins.otas.confirme === true) ||
    (besoins.hebergement_touristique && besoins.hebergement_touristique.confirme === true) ? 3 : 2;
  add('API ouverte', apiWeight, toBool(solution.api_ouverte));

  // F&B : différenciant seulement pertinent si le sujet a été confirmé en entretien.
  const fbConfirme = besoins.fb && besoins.fb.confirme === true;
  if (fbConfirme) {
    add('F&B natif', 2, toBool(solution.solution_fb_native));
    add('F&B intégré', 2, toBool(solution.solution_fb_integre));
    add('Bornes F&B', 2, toBool(solution.bornes_fb));
  }

  add('Support France', 2, toBool(solution.support_france));
  add('Support Europe', 2, toBool(solution.support_europe));
  add('Support 24/7', 2, toBool(solution['support_24/7']));
  add('Langues support (FR)', 2, containsLang(solution.langues_support, 'Français'));
  add('Bureau France', 2, toBool(solution.bureau_france));
  add('Bureau Europe', 2, toBool(solution.bureau_europe));
  add('Paiement intégré', 2, toBool(solution.paiement_integre));
  add('Bornes billet', 2, toBool(solution.bornes_billet));

  const multideviseWeight = besoins.tourisme_international === true ? 2 : 1;
  add('Multidevise', multideviseWeight, toBool(solution.multidevise));

  // Rating et reviews : continu, pas binaire.
  const rating = solution.rating !== null && solution.rating !== undefined ? Number(solution.rating) : 0;
  const ratingPoints = (rating / 5) * 1;
  score += ratingPoints;
  detail.push({ label: 'Note moyenne', weight: 1, obtained: rating > 0, points: Math.round(ratingPoints * 100) / 100 });

  const hasReviews = solution.reviews !== null && solution.reviews !== undefined && Number(solution.reviews) > 0;
  add('Avis clients présents', 1, hasReviews);

  return {
    score: Math.round(score * 100) / 100,
    detail: detail,
    // Champs non pondérés, affichés pour comparaison manuelle (pas de "bonne" valeur universelle).
    a_comparer_manuellement: {
      modele_prix: solution.modele_prix,
      langues_solution: solution.langues_solution
    }
  };
}

async function runScoring(entretienId) {
  const rows = await supabaseRequest(
    '/rest/v1/ben_entretiens?id=eq.' + encodeURIComponent(entretienId) + '&select=*',
    { method: 'GET' }
  );
  if (!rows || rows.length === 0) {
    throw new Error('Entretien introuvable.');
  }
  const entretien = rows[0];
  const data = entretien.donnees_structurees;
  if (!data) {
    throw new Error("Cet entretien n'a pas de données structurées enregistrées.");
  }

  const solutions = await supabaseRequest('/rest/v1/solutions?select=*', { method: 'GET' });

  const evaluated = solutions.map(function (solution) {
    const prereq = passesPrerequis(solution, data);
    if (!prereq.pass) {
      return { name: solution.name, id: solution.id, eliminated: true, reasons: prereq.reasons };
    }
    const scored = computeScore(solution, data);
    return {
      name: solution.name,
      id: solution.id,
      eliminated: false,
      score: scored.score,
      detail: scored.detail,
      a_comparer_manuellement: scored.a_comparer_manuellement
    };
  });

  const survivors = evaluated.filter(function (s) { return !s.eliminated; });
  survivors.sort(function (a, b) { return b.score - a.score; });
  const top3 = survivors.slice(0, 3);

  const result = {
    calcule_le: new Date().toISOString(),
    top3: top3,
    nb_candidats_evalues: solutions.length,
    nb_survivants_prerequis: survivors.length
  };

  await supabaseRequest(
    '/rest/v1/ben_entretiens?id=eq.' + encodeURIComponent(entretienId),
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ operateurs_scores: result })
    }
  );

  return result;
}
// -----------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  try {
    const body = req.body || {};
    const password = body.password;
    const action = body.action;

    if (!process.env.ADMIN_PASSWORD) {
      res.status(500).json({ error: 'ADMIN_PASSWORD non configuré côté serveur.' });
      return;
    }
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Mot de passe incorrect.' });
      return;
    }

    if (action === 'list') {
      const rows = await supabaseRequest(
        '/rest/v1/ben_entretiens?select=*&order=created_at.desc',
        { method: 'GET' }
      );
      res.status(200).json({ rows: rows });
      return;
    }

    if (action === 'validate') {
      const id = body.id;
      if (!id) {
        res.status(400).json({ error: 'id manquant.' });
        return;
      }
      await supabaseRequest(
        '/rest/v1/ben_entretiens?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ statut: 'valide', valide_at: new Date().toISOString() })
        }
      );
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'note') {
      const id = body.id;
      const notes = body.notes || '';
      if (!id) {
        res.status(400).json({ error: 'id manquant.' });
        return;
      }
      await supabaseRequest(
        '/rest/v1/ben_entretiens?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ notes_jeanmarc: notes })
        }
      );
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'score') {
      const id = body.id;
      if (!id) {
        res.status(400).json({ error: 'id manquant.' });
        return;
      }
      const result = await runScoring(id);
      res.status(200).json({ result: result });
      return;
    }

    res.status(400).json({ error: 'Action inconnue.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
};
