# BEN Billetterie — backend

Petit backend serverless (une seule fonction) qui fait deux choses côté serveur, jamais côté navigateur :

1. Appelle l'API Anthropic avec une vraie clé API (jamais visible dans le code du prototype).
2. Dès que la réponse de l'agent contient le bloc de données structurées, écrit l'entretien dans la table Supabase `ben_entretiens`.

C'est un projet Vercel **séparé** du projet TicketMatch existant.

## Fichiers

- `api/chat.js` — la fonction serverless (route `POST /api/chat`).
- `package.json` — rien à installer, la fonction n'utilise que `fetch`, disponible nativement en Node 18+.

## Déploiement sur Vercel

### Option A — via l'interface Vercel (le plus simple, sans ligne de commande)

1. Mets ce dossier (`ben-billetterie-backend/`) dans un dépôt GitHub (nouveau dépôt, par ex. `ben-billetterie-backend`).
2. Sur [vercel.com](https://vercel.com), "Add New… → Project", importe ce dépôt GitHub.
3. Vercel détecte automatiquement le dossier `api/` — pas de configuration de build nécessaire (laisse "Framework Preset: Other").
4. Avant de cliquer sur "Deploy", ouvre "Environment Variables" et ajoute :
   - `ANTHROPIC_API_KEY` = ta clé `sk-ant-api03-...` (celle créée dans la console Anthropic, nommée "BEN Billetterie backend")
   - `SUPABASE_URL` = `https://gzkrqrniewnvqqjswohp.supabase.co`
   - `SUPABASE_ANON_KEY` = la clé anon Supabase (celle déjà utilisée côté prototype)
5. Clique "Deploy". Une fois terminé, Vercel te donne une URL du type `https://ben-billetterie-backend.vercel.app`.
6. L'endpoint à appeler depuis le prototype sera : `https://ben-billetterie-backend.vercel.app/api/chat`.

### Option B — via la CLI Vercel

```bash
npm i -g vercel
cd ben-billetterie-backend
vercel login
vercel
# répondre aux questions (nouveau projet, ne pas lier au projet TicketMatch existant)
vercel env add ANTHROPIC_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel --prod
```

## Sécurité

- La clé Anthropic et les identifiants Supabase ne sont **jamais** dans le code, uniquement en variables d'environnement Vercel.
- La table `ben_entretiens` a une policy RLS "insert only" pour le rôle `anon` : même si la clé anon Supabase venait à fuiter, elle ne permet que d'insérer, jamais de lire, modifier ou supprimer les entretiens des autres exploitants.
- Une fois déployé, il est recommandé de configurer une alerte de budget dans la console Anthropic (Settings → Billing).

## Prochaine étape

Une fois ce backend déployé et son URL connue, il faut mettre à jour `BEN_Billetterie_Agent_Test.html` : remplacer la constante `BACKEND_URL` en haut du script par l'URL réelle (`https://ton-projet.vercel.app/api/chat`).

## Reprise de la synthèse et relance automatique (octobre 2026)

**Reprise.** Un exploitant qui n'a pas validé sa synthèse peut la rouvrir avec son lien personnel `https://agent-ticketmatch.vercel.app/?reprise=<id>` (envoyé par l'email de relance, ou copié depuis l'espace interne avec le bouton « Copier le lien de reprise »). Il retrouve sa synthèse modifiable et le bouton « Valider ma synthèse », sans rien ressaisir. Pendant l'entretien, la conversation est aussi gardée dans son navigateur : s'il ferme l'onglet, il peut reprendre là où il s'était arrêté en revenant sur la page depuis le même navigateur.

**Relance automatique** (`api/relances.js`). Toutes les heures, les entretiens « en attente » terminés depuis plus de 2 h (et moins de 72 h) reçoivent un email unique avec le lien de reprise. L'équipe reçoit en parallèle un email interne avec le téléphone, pour un rappel de vive voix 24 h plus tard si rien ne bouge.

Mise en service (une seule fois) :

1. **Supabase** → SQL Editor : exécuter `supabase/2026-10-12_relance.sql` (ajoute la colonne `relance_envoyee_at`).
2. **Vercel** → Settings → Environment Variables :
   - `RELANCE_CRON_SECRET` = une longue chaîne aléatoire (obligatoire) ;
   - `RELANCE_REPLY_TO` = l'adresse qui doit recevoir les réponses des exploitants (facultatif ; sans elle, l'email ne propose pas de répondre).
3. **GitHub** → Settings → Secrets and variables → Actions : créer le secret `RELANCE_CRON_SECRET` avec la même valeur.
4. Tester sans rien envoyer : onglet Actions, ou
   `curl -X POST -H "Authorization: Bearer <secret>" "https://ben-billetterie-backend.vercel.app/api/relances?dry=1"`
   liste les entretiens qui seraient relancés.

**Espace interne.** Nouveaux boutons sur un entretien en attente : « Copier le lien de reprise » et « Marquer comme validé » (validation obtenue par téléphone ou par email : calcule la shortlist, n'envoie rien à l'exploitant). Le téléphone (facultatif, saisi au démarrage) s'affiche à côté de l'email.

### Entretiens interrompus (brouillons)

Dès la première réponse de l'exploitant, l'entretien est enregistré dans Supabase avec le statut `en_cours` et la conversation complète (colonne `conversation`). Conséquences :

- l'admin affiche les entretiens interrompus (« entretien interrompu », avec la conversation et le téléphone) ;
- la relance automatique les concerne aussi : email « Reprenez votre entretien TicketMatch » 2 h après la dernière activité ;
- le lien `?reprise=<id>` rouvre la conversation là où elle s'était arrêtée, depuis n'importe quel appareil. Si l'exploitant était parti pendant la rédaction de la synthèse, celle-ci est relancée automatiquement.

Prérequis : exécuter `supabase/2026-10-12_brouillon.sql` (colonnes `conversation` et `derniere_activite_at`). Sans cette étape, l'agent fonctionne normalement mais sans brouillon.
