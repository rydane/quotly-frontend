# 🚀 DEFACT Backend — v2.1 (CRM + intégration PDP)

Backend Node.js/Express pour DEFACT — Devis pro en 60 secondes.

---

## 🆕 Nouveautés v2.1

- ✅ **Module CRM (Clients)** : table `clients` + routes `/api/clients/*`
- ✅ **Stub PDP** : architecture prête pour intégrer Tiime/Abby/Sellsy quand le partenariat sera signé (`services/pdp-integration.js`)
- ✅ **Migrations automatiques** : `client_id` ajouté sur `quotes` et `invoices` (FK ON DELETE SET NULL)
- ✅ **Réservé aux plans payants** : le CRM renvoie `403 + upgrade:true` pour les comptes starter
- ✅ **Anti-abus** : 1000 clients max par compte

---

## 📦 Stack

- Node.js 20.x, Express 4.x, PostgreSQL (Supabase recommandé)
- PDFKit (PDF), Nodemailer (emails), bcryptjs + JWT (auth), pg (driver Postgres)

---

## ⚙️ Installation & démarrage

```bash
npm install
npm run dev   # ou: npm start
```

---

## 🔐 Variables d'environnement (.env)

```env
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://defact.fr

JWT_SECRET=CHANGEZ_CE_SECRET_FORT
JWT_EXPIRES_IN=7d

# PostgreSQL (Supabase → Settings > Database > Connection string > URI)
DATABASE_URL=postgresql://postgres:MOTDEPASSE@db.XXXX.supabase.co:5432/postgres

# Gmail App Password
GMAIL_USER=votre@gmail.com
GMAIL_PASS=xxxx xxxx xxxx xxxx
EMAIL_FROM=DEFACT <votre@gmail.com>

# PayPal
PAYPAL_WEBHOOK_ID=...
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_MODE=live
PAYPAL_PLAN_PRO=SLGH8N66YPCAQ
PAYPAL_PLAN_TEAM=BXFT9S9669PWY

# ⏳ PDP (Plateforme Agréée DGFiP) — à configurer après partenariat signé
PDP_PROVIDER=none          # none | tiime | abby | sellsy
PDP_API_URL=
PDP_API_KEY=
PDP_MERCHANT_ID=
```

---

## 📡 Endpoints API — module Clients (CRM)

| Méthode | Route | Description |
|---|---|---|
| GET    | `/api/clients`             | Liste des clients (avec stats agrégées : nb devis, factures, CA) |
| POST   | `/api/clients`             | Crée un client |
| GET    | `/api/clients/:id`         | Détail d'un client |
| PUT    | `/api/clients/:id`         | Met à jour un client |
| DELETE | `/api/clients/:id`         | Supprime un client (devis/factures conservés mais déliés) |
| GET    | `/api/clients/:id/history` | Historique : tous les devis et factures du client |

**Body POST/PUT** :
```json
{
  "name": "Jean Dupont",
  "company": "Acme SARL",
  "email": "jean@acme.fr",
  "phone": "06 12 34 56 78",
  "address": "12 rue de la Paix, 75001 Paris",
  "siret": "123456789 00012",
  "tva": "FR12345678901",
  "tag": "active",
  "notes": "Préfère être contacté le matin"
}
```

`tag` : `lead` (prospect) | `active` (client actif) | `archived`

Tous les endpoints renvoient **403 + `upgrade:true`** pour les comptes `starter`.

---

# ⚠️ ACTIONS QUE TU DOIS FAIRE TOI-MÊME

Cette section est **critique**. Le code est prêt mais il y a des choses qu'aucun script ne peut faire à ta place.

## 1. 🏛️ Structure juridique (à faire AVANT le 1er encaissement)

Tu es lycéen, donc probablement mineur. **En France, un mineur non émancipé ne peut pas exploiter une activité commerciale en son nom propre**. Choisis :

- **Auto-entreprise via un parent** (le plus simple) : un parent crée l'auto-entreprise, tu opères dedans
- **Émancipation** (à partir de 16 ans) : démarche au tribunal, environ 2 mois
- **SAS unipersonnelle (SASU)** : possible à 16 ans avec accord parental, mais 200-300€ de frais de création + comptable

**Indispensable** : tu auras besoin d'un **SIRET** pour pouvoir facturer légalement, déclarer la TVA, et compléter tes Mentions Légales et CGV.

Recommandation : commence en auto-entreprise via un parent. Tu pourras passer en SASU quand tu dépasseras 1000€ de MRR.

## 2. 🌐 Domaine (10€/an — fais-le aujourd'hui)

- Achète `defact.fr` chez **OVH** (~7€/an), **Gandi** (~12€/an), ou **Namecheap**
- Dans Vercel → Settings → Domains → Add → `defact.fr` → suit les instructions DNS
- Ça change tout pour ton SEO, ta crédibilité et ta conversion

## 3. ⚖️ Pages légales — placeholders à remplir

Dans `index.html`, le composant `LEGAL_PAGES` contient 5 gabarits avec des `{ACCOLADES}` à remplacer par tes vraies données :

| Placeholder | À remplir avec |
|---|---|
| `{RAISON_SOCIALE}` | Nom commercial DEFACT par {Prénom Nom} ou nom de la SAS |
| `{FORME}` | "Auto-entreprise" / "EURL" / "SAS" |
| `{ADRESSE}` | Adresse de domiciliation |
| `{SIRET}` | Le SIRET 14 chiffres |
| `{RCS}` + `{NUMÉRO}` | Pour société (pas auto-entreprise) |
| `{FR_TVA}` | N° TVA intracommunautaire (si assujetti) |
| `{NOM PRÉNOM}` | Directeur de la publication (toi ou ton parent) |
| `{DATE}` | Date de mise à jour des CGU/CGV |

**⚠️ Étape obligatoire** : avant de mettre les CGV en ligne en production, fais-les **valider par un juriste**. Ce sont les plus risquées juridiquement (rétractation, garanties). Coût : 200-500€ chez un avocat / gratuit si tu connais quelqu'un de compétent. Sans CGV valides, un litige client peut t'exploser.

## 4. 🤝 Partenariat PDP (Plateforme Agréée DGFiP)

**À faire avant le 1er septembre 2026** pour que la conversion en facture reste légalement valide pour le B2B.

Pour ta cible (TPE/freelances), je te recommande dans cet ordre :

1. **Tiime** — gratuit, API documentée, déjà PA certifié, équipe partenariats accessible
2. **Abby** — freemium, partenaire URSSAF (intéressant pour les auto-entrepreneurs)
3. **Pennylane** — orienté TPE/PME, plus haut de gamme

**Démarche concrète** :
1. Contacte leur équipe partenariats (LinkedIn de leur Head of Partnerships, ou formulaire "Devenir partenaire" sur leur site)
2. Présente DEFACT honnêtement : "On est un outil de devis qui veut s'intégrer à votre PDP via API pour la conversion en facture. Vous restez l'émetteur officiel, on vous redirige les utilisateurs."
3. Ils te donneront une clé API + URL d'endpoint à mettre dans `.env`
4. Implémente la fonction `submitInvoiceToPDP()` dans `services/pdp-integration.js` (le stub est commenté avec un exemple d'appel HTTP)

**Compte 4 à 12 semaines** entre le premier contact et l'intégration en prod. **Commence cette démarche cette semaine** — c'est ce qui prendra le plus de temps.

## 5. 📧 Email transactionnel

Gmail App Password fonctionne pour les premiers tests, mais il y a une **limite de 100 emails/jour** + risque de blacklist si tu envoies trop. Dès que tu dépasses 50 utilisateurs actifs, migre vers :

- **Resend** (https://resend.com) — gratuit jusqu'à 3000 emails/mois, très simple
- **SendGrid** (https://sendgrid.com) — plus complet, gratuit jusqu'à 100/jour
- **Mailgun** — alternative

L'API étant similaire à Nodemailer, le code à modifier dans `services/email.js` est minime.

## 6. 📊 Analytics (optionnel mais recommandé)

Pour savoir qui visite, d'où, ce qu'ils cliquent — sans flicage :

- **Plausible** (https://plausible.io) — 9€/mois, RGPD-friendly, pas de bandeau cookie nécessaire
- **PostHog** (https://posthog.com) — gratuit jusqu'à 1M events/mois, plus complet (heatmaps, funnels)

**Si tu ajoutes Plausible/PostHog** : vérifie `window.__defactCookies?.analytics === true` avant de charger leur script (le `CookieBanner` côté frontend stocke déjà ce flag).

---

# ✅ Checklist déploiement production

Avant d'activer le paiement et de prendre tes premiers clients :

- [ ] Domaine `defact.fr` acheté et configuré sur Vercel
- [ ] Backend déployé sur Render/Railway/Fly avec toutes les variables d'env
- [ ] `DATABASE_URL` Supabase active, schema migré (le schéma se crée auto au démarrage)
- [ ] Test : `GET /health` renvoie 200
- [ ] Test : créer compte → devis → PDF → email envoyé
- [ ] Test : créer un client dans le CRM, voir l'historique
- [ ] Structure juridique créée + SIRET obtenu
- [ ] Mentions Légales remplies avec vraies données
- [ ] CGV relues par un juriste
- [ ] PayPal en mode live (pas sandbox)
- [ ] Paramétré dans Search Console (https://search.google.com/search-console)
- [ ] Sitemap.xml soumis (la génération est à faire — voir module sitemap-static-generator)
- [ ] (Plus tard) Partenariat PDP signé et `services/pdp-integration.js` implémenté

---

## 🐛 Migrations v2.1

Le schéma se crée automatiquement au démarrage. Si tu as une DB existante :

- ✅ La table `clients` est créée si absente
- ✅ Les colonnes `client_id` sont ajoutées à `quotes` et `invoices`
- ✅ Les FK `quotes_client_id_fkey` et `invoices_client_id_fkey` sont créées (ON DELETE SET NULL)
- ✅ Les indexes `idx_clients_user`, `idx_quotes_client`, `idx_invoices_client` sont créés

Aucune action manuelle requise — relance simplement le serveur après avoir déployé.
