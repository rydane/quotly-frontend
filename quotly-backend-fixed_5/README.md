# 🚀 Quotly Backend — v2.0

Backend Node.js/Express pour Quotly — Devis pro en 60 secondes.

---

## 📦 Stack

- **Node.js** 20.x
- **Express** 4.x
- **PostgreSQL** (Supabase recommandé)
- **PDFKit** — génération PDF
- **Nodemailer** — emails (Gmail App Password)
- **bcryptjs** + **jsonwebtoken** — auth sécurisée
- **pg** — driver PostgreSQL

---

## ⚙️ Installation

```bash
npm install
```

---

## 🔐 Variables d'environnement (.env)

```env
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://quotly-frontend.vercel.app

JWT_SECRET=CHANGEZ_CE_SECRET_FORT
JWT_EXPIRES_IN=7d

# PostgreSQL (Supabase → Settings > Database > Connection string > URI)
DATABASE_URL=postgresql://postgres:MOTDEPASSE@db.XXXX.supabase.co:5432/postgres

# Gmail App Password (https://myaccount.google.com/apppasswords)
GMAIL_USER=votre@gmail.com
GMAIL_PASS=xxxx xxxx xxxx xxxx
EMAIL_FROM=Quotly <votre@gmail.com>

# PayPal (optionnel)
PAYPAL_WEBHOOK_ID=VOTRE_WEBHOOK_ID
PAYPAL_CLIENT_ID=VOTRE_CLIENT_ID
PAYPAL_CLIENT_SECRET=VOTRE_CLIENT_SECRET
PAYPAL_MODE=live
PAYPAL_PLAN_PRO=SLGH8N66YPCAQ
PAYPAL_PLAN_TEAM=BXFT9S9669PWY
```

---

## 🗄️ Base de données

Le schéma se crée **automatiquement** au démarrage via `db/schema.js`.

Pour migrer une DB existante (ajoute les nouvelles colonnes) :

```bash
node migrate.js
```

### Colonnes ajoutées en v2 :

| Table   | Colonne            | Type        | Usage                     |
|---------|--------------------|-------------|---------------------------|
| users   | otp_code           | TEXT        | Code 2FA temporaire       |
| users   | otp_expires        | TIMESTAMPTZ | Expiration OTP (10 min)   |
| users   | signatures_count   | INTEGER     | Nb signatures utilisées   |
| quotes  | signer_name        | TEXT        | Nom du signataire         |

---

## 🛠️ Démarrage

```bash
# Développement
npm run dev

# Production
npm start
```

---

## ✅ Fonctionnalités v2

### 🔐 1. Authentification 2FA / OTP

- `POST /api/auth/login` → vérifie email+password, envoie OTP par email
- `POST /api/auth/verify-otp` → vérifie le code, retourne le JWT
- OTP valable **10 minutes**, à 6 chiffres
- En mode dev (si email non configuré), le code s'affiche dans les logs

### ❌ 2. Mot de passe oublié

- `POST /api/auth/forgot-password`
  - ✅ Compte trouvé → envoie email de reset
  - ❌ Compte inexistant → retourne `404` avec message `"Aucun compte trouvé avec cet email."`

### 🚫 3. Protection création de devis (auth obligatoire)

- `POST /api/quotes` requiert un **token JWT valide**
- Sans token → `401 Token manquant`
- Le frontend redirige vers la page de connexion

### 📄 4. Limite plan gratuit — Devis (5/mois)

- Plan `starter` : max **5 devis par mois**
- Compteur remis à zéro chaque mois (via `month_reset`)
- Persistant côté backend (résiste à la déconnexion)
- Dépassement → `403` avec `{ error: "...", upgrade: true }`

### ✍️ 5. Limite signatures électroniques (5 total)

- Plan `starter` : max **5 signatures** (total, pas mensuel)
- Compteur `signatures_count` persistant
- Dépassement → `403` avec `{ upgrade: true }`

### 🧾 6. PDF sans bugs d'encodage

- ✅ Fonction `sanitizeText()` : remplace guillemets courbes, tirets spéciaux, etc.
- ✅ `fmtEuro()` : utilise `EUR` au lieu de `€` (Helvetica Latin-1 safe)
- ✅ `No XXXX` au lieu de `N° XXXX` (° peut corrompre)
- ✅ Colonnes bien alignées (DESIGNATION | QTE | PU HT | TOTAL HT)
- ✅ Compatible tous navigateurs

### 🎨 7. Templates freemium/payant

- Plan `starter` : peut voir et prévisualiser tous les templates
- Téléchargement PDF avec template payant → **bloqué côté backend**
- Création/modification de devis avec template payant → **bloquée côté backend**
- Double vérification frontend + backend pour éviter tout contournement

---

## 📡 Endpoints API

```
POST   /api/auth/register
POST   /api/auth/login          → étape 1 (OTP envoyé)
POST   /api/auth/verify-otp     → étape 2 (retourne JWT)
GET    /api/auth/me
PUT    /api/auth/password
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
DELETE /api/auth/account

GET    /api/quotes
POST   /api/quotes              (auth + quota)
GET    /api/quotes/:id
PUT    /api/quotes/:id
DELETE /api/quotes/:id
GET    /api/quotes/:id/pdf      (auth + template check)
POST   /api/quotes/:id/send     (pro uniquement)
POST   /api/quotes/:id/duplicate
GET    /api/quotes/quota/status

GET    /api/sign/:token
POST   /api/sign/:token         (limite signatures)
GET    /api/sign/status/:quoteId

GET    /api/invoices
POST   /api/invoices
...

GET    /api/stats
GET    /api/settings
PUT    /api/settings
...

GET    /health
```

---

## 🚀 Déploiement Render

1. Créer un **Web Service** sur [render.com](https://render.com)
2. Build command : `npm install`
3. Start command : `node server.js`
4. Configurer les **variables d'environnement** (section Environment)
5. La base de données se configure via `DATABASE_URL` (Supabase)

---

## 🐛 Correctifs v2

| Fichier | Problème | Correction |
|---|---|---|
| `db/schema.js` | Colonnes OTP/signatures absentes du schéma initial | Ajouté + migrations automatiques |
| `migrate.js` | Utilisait `better-sqlite3` au lieu de PostgreSQL | Réécrit pour `pg` |
| `services/email.js` | `db.prepare().run()` (SQLite) → crash en prod | Remplacé par `await db.run()` |
| `services/pdf.js` | Caractères corrompus (€, °, guillemets) | `sanitizeText()` + `fmtEuro()` robuste |
| `routes/auth.js` | forgot-password silencieux si email inconnu | Retourne `404` explicite |
