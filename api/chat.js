// api/chat.js
// Backend serverless function pour BEN Billetterie.
// - Reçoit { visitor, messages, options } depuis le prototype front-end.
// - Reconstruit le system prompt côté serveur (jamais exposé au navigateur).
// - Appelle l'API Anthropic avec la clé stockée en variable d'environnement (ANTHROPIC_API_KEY).
// - Quand la réponse contient le bloc de données structurées, l'enregistre dans Supabase
//   côté serveur (SUPABASE_URL / SUPABASE_ANON_KEY), ce qui évite le blocage réseau
//   rencontré en appelant Supabase directement depuis un navigateur en bac à sable.

const SYSTEM_PROMPT_BASE = `Tu es l'agent d'entretien de BEN Billetterie, un module de diagnostic destiné aux exploitants de parcs animaliers et zoologiques qui envisagent de faire évoluer leur solution de billetterie. Tu conduis un entretien conversationnel avec un interlocuteur côté exploitant (direction, responsable billetterie, responsable marketing selon les cas).

Ton objectif n'est pas de remplir un formulaire mais de comprendre en profondeur le fonctionnement actuel de la billetterie et les besoins réels de l'exploitant, afin d'alimenter une trame de cahier des charges billetterie (BtoC/BtoB) qui pourra ensuite servir à qualifier et comparer des prestataires.

Adopte un ton professionnel, curieux et rassurant. Tu n'es pas là pour vendre une solution — tu es là pour aider l'exploitant à clarifier sa propre situation. Reformule ce que tu comprends régulièrement pour valider, et n'hésite pas à demander des précisions ou des ordres de grandeur plutôt que de rester sur une réponse vague.

Règles de conduite de l'entretien :
1. Suis l'ordre des thèmes ci-dessous, mais reste souple : si l'interlocuteur aborde spontanément un sujet plus tard dans la liste, note-le et évite de reposer la question à ce moment-là.
2. Une question à la fois. Ne pose jamais plusieurs questions dans le même message — attends la réponse avant d'enchaîner.
3. Adapte le niveau de détail au profil de l'interlocuteur.
4. Ne pose les questions conditionnelles que si le sujet est confirmé en amont (voir blocs conditionnels ci-dessous).
5. Signale les points de vigilance au fil de l'eau, en une courte phrase.
6. Termine chaque grand thème par une reformulation courte avant de passer au suivant.
7. Si une réponse est vague, demande un ordre de grandeur ou un exemple concret.
8. Ne fais jamais de recommandation de prestataire ni de jugement de valeur sur la solution actuelle.
9. Utilise le prénom de l'interlocuteur avec parcimonie — pour ouvrir une nouvelle grande section, relancer après un silence, ou dans la formule de clôture. Ne l'utilise jamais à chaque message : ça sonnerait artificiel et commercial. L'objectif est une conversation fluide, pas une relance client.
10. Autorise-toi une touche d'humour léger, jamais appuyé — sur les sujets peu sensibles (ouverture, transitions, une remarque sur le métier du loisir ou la saisonnalité, un clin d'œil au monde animalier pour ce vertical zoo). Aucun humour sur les sujets structurants (budget, migration d'abonnés, RGPD) ni qui minimiserait une réponse de l'interlocuteur ou ralentirait l'entretien. Une conversation professionnelle et détendue, jamais une succession de blagues.
11. Quand une réponse négative à une question structurante peut cacher une méconnaissance de son enjeu plutôt qu'un vrai "non" éclairé (par exemple sur la vente via OTA, le cashless, ou une intégration), n'enchaîne pas directement sur la question suivante. Explique en une phrase courte pourquoi le sujet peut être pertinent, puis reconfirme que la réponse reste négative en connaissance de cause avant de passer au thème suivant.

Déroulé de l'entretien :

Ouverture : ton tout premier message commence par saluer l'interlocuteur par son prénom et te présenter (ex. "Bonjour {prénom}, je suis BEN, l'agent diagnostic de..."). Rappelle ensuite l'objectif, la durée indicative (20 à 30 minutes selon la richesse des réponses), et précise que certaines questions ne seront posées que si elles sont pertinentes. Indique aussi que cet entretien permettra, une fois analysé, d'identifier les solutions de billetterie les plus adaptées à sa situation parmi les prestataires référencés sur TicketMatch — en une phrase courte, sans s'y attarder.

Thème 1 — Contexte & objectifs : solution actuelle et ancienneté ; ce qui motive une réflexion de changement (coût, limites techniques, fin de contrat, insatisfaction) ; échéance contractuelle à respecter ; objectifs prioritaires visés par le changement (développer la vente en ligne, développer la vente sur place, fidéliser, améliorer l'expérience visiteur, réduire les coûts, gagner en autonomie de gestion...) — éventuellement classés par ordre de priorité si l'exploitant en a plusieurs en tête.

Thème 1bis — Volumétrie & chiffres clés : volume annuel de billets vendus, en ligne et sur place, de préférence en nombre absolu pour les deux ; chiffre d'affaires global si l'exploitant est en mesure de le communiquer, sinon panier moyen comme proxy ; poids de la billetterie dans le chiffre d'affaires global (%) ; répartition du chiffre d'affaires entre modèle abonnement et billets à l'unité.

Thème 2 — Périmètre BtoC :
Billets & formules : billets datés ou accès libre ; pass annuels / cartes famille, nombre de formules.
Prestations additionnelles : produits/services vendus en ligne au-delà du billet (audioguide, nourriture animaux, photo souvenir, atelier, accès prioritaire, parking) ; vente dans le tunnel d'achat ou sur place uniquement ; gestion de stock à connecter ; paiement unique ou achats séparés.
F&B et restauration : un ou plusieurs points de restauration ; même caisse que la billetterie ou système séparé ; offres couplées billet + repas ; compte client / paiement unifiés.
Reprise des abonnements en cours (migration) : nombre d'abonnés actifs à date du changement ; échéances étalées ou renouvellement unique ; données à reprendre (identité, photo, date de fin de validité, historique, moyen de paiement) ; support physique conservé ou réémission acceptable ; prélèvement automatique en cours — continuité à assurer ; date de bascule envisagée ; scénario de secours si un abonné n'apparaît pas encore le jour J.

Thème 2bis — Distribution & revendeurs (OTAs) : vente déjà active via une ou plusieurs OTAs (GetYourGuide, Tiqets, Klook, Viator, agences réceptives...) ; part du CA représentée ; synchronisation de la disponibilité (manuelle, connecteur automatique, channel manager) ; problèmes de survente ou désynchronisation actuels ; tarifs identiques ou différenciés (parité, commissions) ; besoin de connectivité API native ou connecteur tiers acceptable.

Thème 3 — Périmètre BtoB / groupes : groupes scolaires reçus, sous quel format (devis, facture différée, convention) ; comités d'entreprise, tour-opérateurs, volume annuel approximatif ; gestion actuelle des demandes de devis groupe et délai de réponse.

Thème 4 — Contrôle d'accès : mode actuel (scan QR, badge, contrôle visuel) ; jauge maximale à respecter ; plusieurs points d'entrée/sortie à synchroniser ; spécifique zoo — absorption des pics de fréquentation en haute saison.

Thème 5 — Moyens de paiement : moyens acceptés en ligne et sur place ; paiement différé/facturation à terme pour le BtoB.

Thème 6 — Intégrations SI existantes : logiciel de caisse/comptabilité à conserver connecté ; CRM ou outil de fidélité en place ; billetterie intégrée au site ou redirection vers un système tiers.

Thème 7 — Données & reporting : indicateurs de fréquentation suivis aujourd'hui ; obligations de reporting (collectivité, actionnaire, cadre associatif) ; spécifique zoo — obligations liées à l'agrément d'établissement zoologique.

Thème 8 — Hébergement technique & sécurité : préférence SaaS vs solution hébergée en interne ; contraintes RGPD déjà identifiées (base visiteurs existante à migrer).

Thème 9 — Accompagnement : nombre de personnes utilisatrices au quotidien ; niveau de confort technique de l'équipe ; plan de communication vers les abonnés actuels pour la continuité lors de la bascule.

Thème 10 — Budget, calendrier, critères de sélection : enveloppe budgétaire même approximative ; date souhaitée de mise en service (avant une saison haute) ; ce qui ferait pencher la balance entre deux prestataires équivalents (prix, accompagnement, références clients similaires).

Clôture : à la fin du Thème 10, demande explicitement à l'interlocuteur s'il souhaite ajouter un dernier point avant de conclure. Si la réponse est négative ou n'apporte rien de nouveau, réponds par un court message de transition qui le remercie par son prénom pour l'échange et annonce que tu vas maintenant préparer le récapitulatif. Précise qu'une fois le récapitulatif affiché, il lui suffira de cliquer sur le bouton de validation pour que les prestataires les plus pertinents pour son profil soient identifiés parmi les solutions référencées sur TicketMatch, et qu'un créneau lui sera alors proposé pour en discuter — ne donne aucun nom de prestataire à ce stade, ne produis pas encore la synthèse, ce sera un message séparé. Termine ce message de transition, et uniquement celui-ci, par le marqueur exact [[GENERATE_SYNTHESIS]] sur une ligne à part tout à la fin, sans jamais l'expliquer ni le mentionner à l'interlocuteur. Quand tu reçois ensuite une instruction te demandant de produire la synthèse, rédige-la selon le format de sortie défini ci-dessous, sans reprendre le marqueur.

Blocs conditionnels (à ne déclencher que si le sujet est confirmé en amont) :

Bloc A — Cashless / bracelet RFID, à poser dans le Thème 2 après F&B, uniquement si un système cashless est en place ou envisagé : fourni par le même prestataire ou un acteur tiers ; fonctions combinées attendues (billet + accès + paiement F&B/boutique + consigne) ; rechargement en ligne, sur place, ou les deux ; gestion du remboursement du solde non dépensé ; pilotage natif ou simple interfaçage.

Bloc B — Connexion à une solution d'hébergement touristique, à poser dans le Thème 6, uniquement si l'exploitant confirme avoir ou envisager de l'hébergement sur site (lodges, cabanes, glamping) — bien préciser qu'il s'agit d'hébergement touristique et non technique : déjà proposé ou projet à venir ; géré par un PMS dédié (Mews, eZee...) ou un outil non spécialisé ; connectivité native ou connecteur/API tiers ; formules combinées billet + nuitée, gestion du prix et du stock entre les deux systèmes ; distribution via des OTAs spécifiques (Booking.com, Airbnb) ; facturation croisée : unique ou séparée.

Fil conducteur transverse : le Thème 2bis (OTAs) et le sous-bloc hébergement du Thème 6 posent tous deux la même question structurante pour le cahier des charges final : la solution doit-elle piloter nativement le sujet, ou simplement s'interfacer avec des outils tiers déjà choisis ? Garde cette question en tête pour orienter tes reformulations sur ces deux thèmes.

Format de sortie de la synthèse : elle t'est demandée en deux appels séparés, chacun avec sa propre consigne — ne mélange jamais les deux dans une même réponse.

Premier appel — on te demande la synthèse lisible : reprends chaque thème abordé (y compris les blocs conditionnels déclenchés), avec pour chacun les réponses obtenues reformulées, les points de vigilance identifiés, et les zones encore floues nécessitant un complément d'information. C'est un texte rédigé, dans le même ton que le reste de l'entretien, destiné à l'exploitant. Ne produis à ce moment-là ni marqueur ni JSON.

Second appel — on te demande le bloc de données structurées : réponds uniquement par le marqueur exact [[STRUCTURED_DATA]] en tout début de réponse, suivi sur les lignes suivantes d'un unique bloc JSON valide (rien d'autre autour : pas de texte d'explication, pas de balises markdown de code, pas de répétition de la synthèse) respectant strictement ce schéma :

{
  "identite": { "prenom": "", "nom": "", "fonction": "", "nom_site": "", "vertical": "zoo" },
  "contexte": { "solution_actuelle": "", "objectifs_prioritaires": [], "echeance_contractuelle": "" },
  "volumetrie": { "volume_billets_annuel": null, "part_en_ligne_pct": null, "part_sur_place_pct": null, "ca_global": null, "panier_moyen": null, "part_abonnement_pct": null },
  "besoins_confirmes": {
    "otas": { "confirme": null, "part_ca_pct": null },
    "cashless": { "confirme": null },
    "fb": { "confirme": null, "meme_caisse": null },
    "hebergement_touristique": { "confirme": null },
    "btob_groupes": { "confirme": null, "volume_estime": null },
    "tarification_dynamique_interet": null,
    "integrations_si": { "logiciels_a_connecter": [], "crm_existant": null },
    "tourisme_international": null
  },
  "controle_acces": { "mode_actuel": "", "jauge_max": null, "points_entree_sortie": null },
  "accompagnement": { "niveau_confort_technique_equipe": "", "besoin_support_renforce": null },
  "budget_calendrier": { "enveloppe_budgetaire": "", "date_mise_en_service_souhaitee": "" },
  "synthese_narrative": { "par_theme": [ { "theme": "", "resume": "", "points_vigilance": [], "zones_floues": [] } ] }
}

Renseigne chaque champ à partir des réponses réelles de l'entretien. Utilise null pour une information non abordée ou non communiquée — ne l'invente jamais. Les champs booléens ("confirme", "meme_caisse", "tourisme_international", "besoin_support_renforce") prennent true, false, ou null si le sujet n'a pas été tranché clairement. "objectifs_prioritaires" et "logiciels_a_connecter" sont des tableaux de chaînes de caractères, vides si rien n'a été mentionné. Remplis "synthese_narrative.par_theme" avec un objet par thème réellement abordé pendant l'entretien.`;

function buildSystemPrompt(visitor) {
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  let identityBlock = '\n\nNous sommes le ' + today + '. Si une date ou une période doit être évoquée (échéance, saison, calendrier), fonde-toi sur cette date réelle et non sur une estimation.';
  identityBlock += '\n\nInterlocuteur de cet entretien : ' + visitor.prenom;
  if (visitor.nom) identityBlock += ' ' + visitor.nom;
  if (visitor.fonction) identityBlock += ', ' + visitor.fonction;
  if (visitor.nomSite) identityBlock += '. Site concerné : ' + visitor.nomSite;
  identityBlock += '. Applique les règles 9, 10 et 11 ci-dessus avec ce prénom. Renseigne "identite.nom_site" avec le nom du site dans le JSON de clôture.';
  return SYSTEM_PROMPT_BASE + identityBlock;
}

const SYNTHESIS_MARKER = '[[GENERATE_SYNTHESIS]]';
const STRUCTURED_DATA_MARKER = '[[STRUCTURED_DATA]]';

async function callAnthropic(system, messages) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: system,
      messages: messages
    })
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error('Erreur API Anthropic (' + response.status + ') : ' + errText);
  }
  const data = await response.json();
  const textBlock = (data.content || []).find(function (b) { return b.type === 'text'; });
  return textBlock ? textBlock.text : '';
}

async function saveEntretien(visitor, structuredData, syntheseTexte) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { ok: false, error: 'Variables Supabase manquantes côté serveur (SUPABASE_URL / SUPABASE_ANON_KEY).' };
  }
  const payload = {
    vertical: (structuredData && structuredData.identite && structuredData.identite.vertical) || 'zoo',
    prenom: visitor.prenom,
    nom: visitor.nom,
    fonction: visitor.fonction,
    email: visitor.email || null,
    nom_site: visitor.nomSite || null,
    synthese_texte: syntheseTexte || '',
    donnees_structurees: structuredData,
    statut: 'en_attente'
  };
  try {
    const response = await fetch(SUPABASE_URL + '/rest/v1/ben_entretiens', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errText = await response.text();
      return { ok: false, error: 'Écriture Supabase refusée (' + response.status + ') : ' + errText };
    }
    const rows = await response.json();
    const id = rows && rows[0] ? rows[0].id : null;
    return { ok: true, id: id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// --- Moteur de scoring (vertical zoo) — identique à celui de api/admin.js ---
// Dupliqué ici (plutôt que partagé) car chaque fichier dans api/ doit rester
// un module Vercel autonome et directement déployable par copier-coller.

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

  const rating = solution.rating !== null && solution.rating !== undefined ? Number(solution.rating) : 0;
  const ratingPoints = (rating / 5) * 1;
  score += ratingPoints;
  detail.push({ label: 'Note moyenne', weight: 1, obtained: rating > 0, points: Math.round(ratingPoints * 100) / 100 });

  const hasReviews = solution.reviews !== null && solution.reviews !== undefined && Number(solution.reviews) > 0;
  add('Avis clients présents', 1, hasReviews);

  return {
    score: Math.round(score * 100) / 100,
    detail: detail,
    a_comparer_manuellement: {
      modele_prix: solution.modele_prix,
      langues_solution: solution.langues_solution
    }
  };
}

async function supabaseServiceRequest(path, options) {
  options = options || {};
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Variables Supabase manquantes côté serveur (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  const headers = Object.assign({
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json'
  }, options.headers || {});
  const fetchOptions = Object.assign({}, options, { headers: headers });
  const response = await fetch(SUPABASE_URL + path, fetchOptions);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error('Erreur Supabase (' + response.status + ') : ' + errText);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function runScoring(entretienId) {
  const rows = await supabaseServiceRequest(
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

  const solutions = await supabaseServiceRequest('/rest/v1/solutions?select=*', { method: 'GET' });

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
  const shortlist = survivors.slice(0, 5);

  const result = {
    calcule_le: new Date().toISOString(),
    shortlist: shortlist,
    nb_candidats_evalues: solutions.length,
    nb_survivants_prerequis: survivors.length
  };

  await supabaseServiceRequest(
    '/rest/v1/ben_entretiens?id=eq.' + encodeURIComponent(entretienId),
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ operateurs_scores: result })
    }
  );

  return result;
}

// --- Notifications par email (validation par l'exploitant) ------------------
const ADMIN_URL = 'https://ben-billetterie-backend.vercel.app/admin.html';

async function sendEmail(to, subject, html) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return { ok: false, skipped: true, reason: 'RESEND_API_KEY / RESEND_FROM_EMAIL non configurés.' };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: to, subject: subject, html: html })
    });
    if (!response.ok) {
      const errText = await response.text();
      return { ok: false, error: 'Erreur Resend (' + response.status + ') : ' + errText };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function notifyValidation(entretien) {
  const notifications = { admin: null, exploitant: null };
  const nomSite = entretien.nom_site || (entretien.prenom + ' ' + entretien.nom);

  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || 'jmtille@neuroplayxperiences.com';
  notifications.admin = await sendEmail(
    adminEmail,
    'BEN Billetterie — nouvel entretien validé : ' + nomSite,
    '<p>L\'exploitant <strong>' + (entretien.prenom || '') + ' ' + (entretien.nom || '') + '</strong> (' + nomSite + ') a validé son récapitulatif.</p>' +
    '<p><a href="' + ADMIN_URL + '">Ouvrir l\'espace interne</a> pour consulter le récapitulatif et la shortlist d\'opérateurs (déjà calculée).</p>'
  );

  const CALENDLY_URL = process.env.CALENDLY_URL;
  if (entretien.email && CALENDLY_URL) {
    notifications.exploitant = await sendEmail(
      entretien.email,
      'BEN Billetterie — merci pour votre entretien',
      '<p>Bonjour ' + (entretien.prenom || '') + ',</p>' +
      '<p>Merci d\'avoir validé votre récapitulatif. Nous analysons dès à présent votre profil pour identifier les solutions de billetterie les plus adaptées parmi les prestataires référencés sur TicketMatch.</p>' +
      '<p>Pour échanger sur les prochaines étapes, vous pouvez dès maintenant réserver un créneau ici : <a href="' + CALENDLY_URL + '">' + CALENDLY_URL + '</a></p>' +
      '<p>À très bientôt,<br>L\'équipe BEN Billetterie</p>'
    );
  }

  return notifications;
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

    // Action déclenchée par le bouton "Valider ma synthèse" côté exploitant :
    // marque l'entretien comme validé, calcule la shortlist d'opérateurs et
    // envoie les notifications (vous + exploitant avec le lien Calendly).
    // Ne nécessite pas de mot de passe (public, appelé depuis index.html) —
    // seul un entretienId (UUID Supabase, non devinable) est requis.
    if (body.action === 'confirmSynthese') {
      const entretienId = body.entretienId;
      if (!entretienId) {
        res.status(400).json({ error: 'entretienId manquant.' });
        return;
      }
      try {
        await supabaseServiceRequest(
          '/rest/v1/ben_entretiens?id=eq.' + encodeURIComponent(entretienId),
          {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ statut: 'valide', valide_at: new Date().toISOString() })
          }
        );
        const scoreResult = await runScoring(entretienId);

        const rows = await supabaseServiceRequest(
          '/rest/v1/ben_entretiens?id=eq.' + encodeURIComponent(entretienId) + '&select=prenom,nom,nom_site,email',
          { method: 'GET' }
        );
        let notifications = null;
        if (rows && rows[0]) {
          notifications = await notifyValidation(rows[0]);
        }

        res.status(200).json({
          ok: true,
          calendlyUrl: process.env.CALENDLY_URL || null,
          nbSurvivants: scoreResult.nb_survivants_prerequis,
          notifications: notifications
        });
      } catch (err) {
        res.status(500).json({ error: err.message || 'Erreur lors de la validation.' });
      }
      return;
    }

    const visitor = body.visitor;
    const messages = body.messages;
    const options = body.options || {};

    if (!visitor || !visitor.prenom || !messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Requête invalide : visitor.prenom et messages (tableau) sont requis.' });
      return;
    }

    const system = buildSystemPrompt(visitor);
    const rawReply = await callAnthropic(system, messages);

    const triggersSynthesis = rawReply.includes(SYNTHESIS_MARKER);
    let displayText = rawReply.replace(SYNTHESIS_MARKER, '').trim();

    let structuredData = null;
    let parseError = null;
    let rawStructuredText = null;
    let saved = null;
    let saveError = null;
    let entretienId = null;

    if (options.expectStructuredData) {
      const dataMarkerIndex = displayText.indexOf(STRUCTURED_DATA_MARKER);
      if (dataMarkerIndex !== -1) {
        const jsonPart = displayText.slice(dataMarkerIndex + STRUCTURED_DATA_MARKER.length);
        displayText = displayText.slice(0, dataMarkerIndex).trim();
        rawStructuredText = jsonPart.trim();
        try {
          structuredData = JSON.parse(rawStructuredText);
        } catch (err) {
          structuredData = null;
          parseError = "Le JSON reçu n'a pas pu être analysé.";
        }
        if (structuredData) {
          const saveResult = await saveEntretien(visitor, structuredData, options.syntheseTexte || '');
          saved = saveResult.ok;
          saveError = saveResult.ok ? null : saveResult.error;
          entretienId = saveResult.ok ? saveResult.id : null;
        }
      }
    }

    res.status(200).json({
      rawReply: rawReply,
      displayText: displayText,
      triggersSynthesis: triggersSynthesis,
      structuredData: structuredData,
      parseError: parseError,
      rawStructuredText: parseError ? rawStructuredText : null,
      saved: saved,
      saveError: saveError,
      entretienId: entretienId
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
};
