// api/relances.js
// Relance automatique des exploitants qui n'ont pas validé leur synthèse.
//
// Appelée toutes les heures par un déclencheur planifié (voir
// .github/workflows/relances.yml). Pour chaque entretien :
//   - "en_attente" (synthèse non validée) ou "en_cours" (entretien interrompu
//     avant la synthèse), non archivé, jamais relancé,
//   - sans activité depuis plus de RELANCE_DELAI_HEURES (2 h par défaut)
//     et depuis moins de RELANCE_FENETRE_HEURES (72 h par défaut),
// elle envoie UN email à l'exploitant avec son lien de reprise personnel, prévient
// l'équipe en interne (pour un rappel humain 24 h plus tard si rien ne bouge), puis
// note la date d'envoi dans la colonne relance_envoyee_at. Un entretien n'est donc
// jamais relancé deux fois automatiquement.
//
// Prérequis Supabase (une seule fois) : supabase/2026-10-12_relance.sql et
// supabase/2026-10-12_brouillon.sql.
//
// Variables d'environnement Vercel :
//   RELANCE_CRON_SECRET     (obligatoire) secret partagé avec le déclencheur planifié
//   RELANCE_REPLY_TO        (facultatif) adresse qui reçoit les réponses des exploitants
//   PUBLIC_AGENT_URL        (facultatif) défaut : https://agent-ticketmatch.vercel.app/
//   RELANCE_DELAI_HEURES    (facultatif) défaut : 2
//   RELANCE_FENETRE_HEURES  (facultatif) défaut : 72
// + celles déjà utilisées par api/chat.js : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   RESEND_API_KEY, RESEND_FROM_EMAIL, ADMIN_NOTIFY_EMAIL.
//
// Fichier volontairement autonome (comme api/chat.js et api/admin.js) : il peut être
// déployé tel quel, sans dépendance partagée.

const ADMIN_URL = 'https://ben-billetterie-backend.vercel.app/admin.html';

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

async function sendEmail(to, subject, html, replyTo) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return { ok: false, error: 'RESEND_API_KEY / RESEND_FROM_EMAIL non configurés.' };
  }
  const payload = { from: RESEND_FROM_EMAIL, to: to, subject: subject, html: html };
  if (replyTo) payload.reply_to = replyTo;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
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

function escapeHtml(str) {
  return String(str === null || str === undefined ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function repriseUrl(entretienId) {
  const base = process.env.PUBLIC_AGENT_URL || 'https://agent-ticketmatch.vercel.app/';
  const u = new URL(base);
  u.searchParams.set('reprise', entretienId);
  return u.toString();
}

function buildInterrompuEmail(row, link, canReply) {
  const prenom = escapeHtml(row.prenom || '');
  const site = row.nom_site ? ' pour ' + escapeHtml(row.nom_site) : '';
  return '<p>Bonjour ' + prenom + ',</p>' +
    '<p>Vous avez commencé votre entretien avec l\'agent TicketMatch' + site + ', mais il s\'est interrompu ' +
    'avant la fin. Vos réponses sont conservées : vous pouvez reprendre exactement là où vous vous étiez arrêté, ' +
    'depuis n\'importe quel ordinateur ou téléphone.</p>' +
    '<p><a href="' + link + '" style="display:inline-block;padding:10px 18px;background:#3f6b4a;color:#ffffff;' +
    'text-decoration:none;border-radius:4px;">Reprendre mon entretien</a></p>' +
    (canReply ? '<p>Une question ou un point qui vous fait hésiter ? Répondez simplement à cet email.</p>' : '') +
    '<p>Pour rappel : la mise en relation est gratuite et sans engagement, et vos informations ' +
    'ne sont transmises à aucun opérateur sans votre accord.</p>' +
    '<p>Belle journée,<br>L\'équipe TicketMatch</p>';
}

function buildExploitantEmail(row, link, canReply) {
  const prenom = escapeHtml(row.prenom || '');
  const site = row.nom_site ? ' pour ' + escapeHtml(row.nom_site) : '';
  return '<p>Bonjour ' + prenom + ',</p>' +
    '<p>Merci d\'avoir pris le temps de répondre à l\'agent TicketMatch' + site + '. ' +
    'Votre échange est complet : il ne reste qu\'à valider votre synthèse pour que nous puissions ' +
    'identifier les solutions de billetterie les plus adaptées.</p>' +
    '<p><a href="' + link + '" style="display:inline-block;padding:10px 18px;background:#3f6b4a;color:#ffffff;' +
    'text-decoration:none;border-radius:4px;">Reprendre et valider ma synthèse</a></p>' +
    '<p>Vous retrouverez votre synthèse telle que vous l\'avez laissée, sans rien ressaisir, ' +
    'et vous pourrez encore la corriger avant de valider.</p>' +
    (canReply ? '<p>Une question ou un point qui vous fait hésiter ? Répondez simplement à cet email.</p>' : '') +
    '<p>Pour rappel : la mise en relation est gratuite et sans engagement, et vos informations ' +
    'ne sont transmises à aucun opérateur sans votre accord.</p>' +
    '<p>Belle journée,<br>L\'équipe TicketMatch</p>';
}

function telephoneOf(row) {
  const ident = (row.donnees_structurees && row.donnees_structurees.identite) || {};
  const conv = (row.conversation && row.conversation.visitor) || {};
  return ident.telephone || conv.telephone || '';
}

function buildAdminEmail(row, link) {
  const tel = telephoneOf(row) ? escapeHtml(telephoneOf(row)) : 'non renseigné';
  const situation = row.statut === 'en_cours'
    ? 'entretien interrompu avant la synthèse'
    : 'synthèse non validée';
  const nomSite = escapeHtml(row.nom_site || ((row.prenom || '') + ' ' + (row.nom || '')));
  const rappel = new Date(Date.now() + 24 * 3600 * 1000).toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
  });
  return '<p>Relance automatique envoyée à <strong>' + escapeHtml(row.prenom || '') + ' ' + escapeHtml(row.nom || '') +
    '</strong> (' + nomSite + ') : ' + situation + '.</p>' +
    '<ul>' +
    '<li>Fonction : ' + escapeHtml(row.fonction || '') + '</li>' +
    '<li>Email : ' + escapeHtml(row.email || '') + '</li>' +
    '<li>Téléphone : ' + tel + '</li>' +
    '</ul>' +
    '<p>Si rien n\'a bougé <strong>' + rappel + '</strong>, un rappel de vive voix est prévu.</p>' +
    '<p><a href="' + ADMIN_URL + '">Ouvrir l\'espace interne</a> · <a href="' + link + '">Lien de reprise de l\'exploitant</a></p>';
}

module.exports = async function handler(req, res) {
  // Authentification : "Authorization: Bearer <RELANCE_CRON_SECRET>".
  const secret = process.env.RELANCE_CRON_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'RELANCE_CRON_SECRET non configuré côté serveur.' });
    return;
  }
  const auth = req.headers.authorization || '';
  if (auth !== 'Bearer ' + secret) {
    res.status(401).json({ error: 'Non autorisé.' });
    return;
  }

  // ?dry=1 : liste les entretiens qui seraient relancés, sans rien envoyer.
  const dryRun = req.query && (req.query.dry === '1' || req.query.dry === 'true');

  const delaiH = Number(process.env.RELANCE_DELAI_HEURES || 2);
  const fenetreH = Number(process.env.RELANCE_FENETRE_HEURES || 72);
  const now = Date.now();
  const avant = now - delaiH * 3600 * 1000;
  const apres = now - fenetreH * 3600 * 1000;
  // Large présélection côté base (30 jours), filtrage fin sur la dernière activité ici.
  const depuis = new Date(now - 30 * 24 * 3600 * 1000).toISOString();

  try {
    const candidates = await supabaseServiceRequest(
      '/rest/v1/ben_entretiens?select=*' +
      '&statut=in.(en_attente,en_cours)&relance_envoyee_at=is.null&archive=not.is.true&email=not.is.null' +
      '&created_at=gt.' + encodeURIComponent(depuis) +
      '&order=created_at.asc',
      { method: 'GET' }
    );
    const rows = (candidates || []).filter(function (r) {
      const last = Date.parse(r.derniere_activite_at || r.created_at);
      return last < avant && last > apres;
    });

    const replyTo = process.env.RELANCE_REPLY_TO || null;
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || 'jmtille@neuroplayxperiences.com';
    const results = [];

    for (const row of rows || []) {
      const link = repriseUrl(row.id);
      if (dryRun) {
        results.push({ id: row.id, statut: row.statut, email: row.email, nom_site: row.nom_site, derniere_activite_at: row.derniere_activite_at || row.created_at, dryRun: true });
        continue;
      }
      const interrompu = row.statut === 'en_cours';
      const exploitant = await sendEmail(
        row.email,
        interrompu ? 'Reprenez votre entretien TicketMatch' : 'Votre synthèse TicketMatch vous attend',
        interrompu ? buildInterrompuEmail(row, link, Boolean(replyTo)) : buildExploitantEmail(row, link, Boolean(replyTo)),
        replyTo
      );
      if (!exploitant.ok) {
        // Pas de marquage : l'entretien sera retenté au prochain passage.
        results.push({ id: row.id, sent: false, error: exploitant.error });
        continue;
      }
      await supabaseServiceRequest(
        '/rest/v1/ben_entretiens?id=eq.' + encodeURIComponent(row.id),
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ relance_envoyee_at: new Date().toISOString() })
        }
      );
      const admin = await sendEmail(
        adminEmail,
        'Agent TicketMatch — relance envoyée : ' + (row.nom_site || ((row.prenom || '') + ' ' + (row.nom || ''))),
        buildAdminEmail(row, link)
      );
      results.push({ id: row.id, statut: row.statut, sent: true, adminNotified: admin.ok });
    }

    res.status(200).json({ ok: true, checked: (rows || []).length, dryRun: dryRun, results: results });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur serveur.' });
  }
};
