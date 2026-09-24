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
