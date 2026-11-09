# Local Lead Studio

API Express autonome pour trouver des commerces dans OpenStreetMap, préparer une démo HTML, rédiger les messages, et gérer les envois/relances avec Supabase, Groq, GitHub Pages, Brevo et QStash. **DRY_RUN=true par défaut.** Aucune sollicitation commerciale n'est envoyée avant activation explicite. En simulation, `/admin/process` peut néanmoins générer et publier les démos publiques sur GitHub Pages; seul l'envoi Brevo et la planification des relances sont bloqués.

## Démarrage rapide depuis un iPhone

1. Créez un compte GitHub et un dépôt public vide (ex. `local-lead-studio`). Dans le dépôt, ouvrez **Settings → Pages**, publiez depuis la branche `main`, dossier `/ (root)`. Les previews sont publiées dans des sous-dossiers à noms aléatoires.
2. Dans Supabase, créez un projet. Ouvrez **SQL Editor → New query**, collez `sql/schema.sql`, puis **Run**. Récupérez la connection string sous **Project Settings → Database**.
3. Créez les clés : Groq Console → API key; Brevo → SMTP & API → API key; Upstash → QStash → token et deux signing keys. GitHub → Settings → Developer settings → Fine-grained personal access token, limité au dépôt, permission **Contents: Read and write**.
4. Déployez ce dossier sur Render comme **Web Service** (Node, build `npm install`, start `npm start`, branche `main`). Dans Render → **Environment**, ajoutez les variables de `.env.example`. Render injecte automatiquement `PORT`. Renseignez `PUBLIC_BASE_URL` avec l’URL `https://…onrender.com` de votre service et `GITHUB_PAGES_BASE_URL` avec l’URL Pages du dépôt. Gardez `DRY_RUN=true`.
5. Dans Upstash QStash, créez un **Cron** quotidien vers `POST https://VOTRE-SERVICE.onrender.com/health?task=digest` (par exemple chaque jour à 08:00 UTC). Le cron est signé par QStash; cet endpoint déclenche le digest, tandis qu'un `GET /health` normal reste sans effet de bord.
6. Dans Brevo, configurez les événements transactionnels **open, click, hard bounce, soft bounce, delivered, unsubscribe** vers `https://VOTRE-SERVICE.onrender.com/webhooks/brevo?key=BREVO_WEBHOOK_TOKEN`. Les réponses directes sont déjà dirigées vers `REPLY_TO_EMAIL`. Pour une alerte événementielle de réponse reçue, configurez un parseur/forwarding entrant de votre fournisseur mail qui POSTe `{ "from": "prospect@example.com" }` vers `/webhooks/inbound?key=BREVO_WEBHOOK_TOKEN`.
7. Testez `GET /health`, puis dans un client API iPhone (ex. HTTPBot/Reqable) appelez les routes ci-dessous avec l'en-tête `Authorization: Bearer ADMIN_TOKEN`. Gardez le mode simulation jusqu'à validation des démos, adresse physique et règles locales. Pour l'envoi réel, changez `DRY_RUN=false` dans Render et redéployez; les messages simulés restent brouillons et seront mis en file lors du prochain `POST /admin/process`. Vérifiez d'abord `MAX_EMAILS_PER_DAY=1`, puis augmentez graduellement.

> N'ajoutez aucune clé dans le dépôt. Les variables Render sont le `.env` de production; `.env.example` ne contient que des valeurs fictives. Pour tester en local, copiez `.env.example` en `.env`, remplissez les champs et lancez `npm install && npm start`.

## Interface de pilotage

Le fichier `index.html` est le dashboard statique, servi par GitHub Pages à `https://emstronglezin-cmd.github.io/auto-client/`. Il appelle le backend défini dans l’interface et propose santé, stats, recherche, traitement, digest et liste paginée des leads. L’utilisateur saisit `ADMIN_TOKEN` en session; le navigateur ne le sauvegarde pas. L’API n’autorise que l’origine `FRONTEND_ORIGIN` (par défaut `https://emstronglezin-cmd.github.io`).

## API

- `GET /health` : état service/DB/schéma; renvoie `TABLE:leads` etc. si les tables SQL ne sont pas encore créées, sans exposer les secrets.
- `GET /stats` : stats simples, token admin requis.
- `GET /admin/leads?limit=30&offset=0&status=nouveau` : liste paginée protégée des prospects (email, téléphone, statut et lien de démo).
- `POST /admin/hunt` : `{ "country":"United States", "city":"", "category":"restaurant" }`. `city` est facultative : vide, la recherche utilise la frontière du pays et limite la réponse aux 1 500 premiers objets; renseignée, elle cherche dans la ville. Secteurs disponibles dans le tableau de bord : restauration, cafés, boulangeries, salons, soins, artisans, commerces et plusieurs services professionnels. Overpass ne retourne que les objets nommés sans tag `website`; l'email n'est pris que depuis `contact:email` ou `email`. Sans email, statut **contact manuel**.
- `POST /admin/process` : prépare/publie les démos puis met en file les prospects éligibles. En simulation, les messages sont enregistrés `dry_run`, sans appel d'envoi Brevo ni planification de relance.
- `POST /admin/digest` : envoie le digest au propriétaire (sans envoi en DRY_RUN).
- `POST /jobs/send-email`, `/jobs/followup` : routes internes QStash, signature obligatoire.
- `POST /webhooks/brevo`, `/webhooks/inbound` : webhooks protégés par le paramètre secret `key`.
- `GET /unsubscribe/:token` : désinscription signée; ajoute la personne à la blocklist et annule les emails en file.

Chaque requête admin utilise `Authorization: Bearer <ADMIN_TOKEN>`. Les emails prospects identifient l'expéditeur, incluent un lien de désinscription, l'adresse postale et le Reply-To. Le quota inclut la réservation des campagnes initiales et vérifie aussi la cadence réelle des envois. Les messages sont espacés par QStash, sans timer en mémoire. Les relances uniques sont envoyées à J+3 puis J+7 si aucune réponse/désinscription.

## Schéma et vérifications

- `sql/schema.sql` crée `leads`, `demos`, `emails`, `events` et `blocklist` (blocklist persistante pour empêcher tout nouvel envoi après opt-out).
- `npm test` exécute les tests unitaires.
- Logs: uniquement erreurs et identifiants techniques; aucune clé n'est loggée.

## Notes de conformité

Respectez les lois applicables (CAN-SPAM, CASL, UK PECR, RGPD/ePrivacy et règles nationales), la base légale et les exigences de preuve/identification de l'expéditeur. Vérifiez l'adresse physique réelle, la légitimité de chaque contact et les règles locales avant tout envoi. Le fait qu'une adresse soit publique dans OSM n'autorise pas automatiquement le démarchage. Les horaires de démonstration sont explicitement fictifs/à confirmer; relisez et corrigez toute démo avant de la présenter comme contenu final. Les pages GitHub Pages sont publiquement accessibles malgré leur chemin aléatoire: ce n'est pas un contrôle d'accès ni un secret durable.

## Dépannage Render

Le service démarre maintenant même si les variables ne sont pas encore renseignées : `GET /health` renvoie HTTP 200 avec `status: degraded` et les noms des variables manquantes; les routes admin renvoient HTTP 503 jusqu'à configuration. Si `DATABASE_URL` est renseignée mais que la base ne répond pas, `/health` renvoie 503. Dans Render → **Environment**, ajoute au minimum `ADMIN_TOKEN` (32+ caractères aléatoires), `DATABASE_URL`, `PUBLIC_BASE_URL` (URL HTTPS réelle du service) et `UNSUBSCRIBE_SECRET` (32+ caractères), puis redéploie. Vérifie aussi que `DATABASE_SSL=true` et que le schéma Supabase a été exécuté. Pour appeler `/admin/process` même en DRY_RUN, renseigne aussi Groq et GitHub. Pour les envois réels, remplis toutes les variables Brevo/QStash indiquées dans `.env.example`.

Le fichier `render.yaml` donne la configuration de référence (`npm ci`, `npm start`, health check `/health`). Pour un service Render déjà créé, applique manuellement ces commandes dans **Settings**; le fichier Blueprint seul ne remplace pas les variables d'environnement du service existant. Évite de mélanger Yarn et npm : ce dépôt versionne `package-lock.json`, donc utilise `npm ci`.
