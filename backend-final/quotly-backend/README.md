# 🚀 Quotly Backend — Guide de déploiement complet

Backend Node.js/Express complet pour [Quotly](https://quotly-devis.netlify.app) — prêt à mettre en production.

---

## 📦 Stack technique

| Composant | Technologie |
|---|---|
| Runtime | Node.js ≥ 18 |
| Framework | Express 4 |
| Base de données | SQLite (better-sqlite3) |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| PDF | PDFKit |
| Emails | Nodemailer (SMTP) |
| Upload | Multer |
| Paiements | PayPal Webhooks |
| Sécurité | Helmet + express-rate-limit + CORS |

---

## ⚡ Installation rapide (5 minutes)

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer l'environnement
cp .env.example .env
nano .env   # Remplir les valeurs

# 3. Lancer en développement
npm run dev

# 4. Lancer en production
npm start
```

---

## 🌐 Où déployer ?

### Option 1 — Railway (recommandé, gratuit pour commencer)

1. Créer un compte sur [railway.app](https://railway.app)
2. Cliquer **New Project → Deploy from GitHub**
3. Uploader ce dossier ou connecter votre repo Git
4. Ajouter les variables d'environnement dans l'onglet **Variables**
5. Railway détecte automatiquement Node.js et lance `npm start`
6. Votre API est disponible sur `https://votre-app.railway.app`

**Coût :** ~5$/mois pour un usage normal

---

### Option 2 — Render (gratuit avec limitations)

1. Créer un compte sur [render.com](https://render.com)
2. **New → Web Service → Connect a repository**
3. Build command : `npm install`
4. Start command : `node server.js`
5. Ajouter les variables d'env dans **Environment**

**Coût :** Gratuit (cold start 50s) ou ~7$/mois (always-on)

---

### Option 3 — VPS OVH / Hetzner (production sérieuse)

```bash
# Sur le VPS (Ubuntu 22.04)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Copier les fichiers
scp -r quotly-backend/ user@votre-ip:/var/www/quotly/

# Sur le VPS
cd /var/www/quotly
npm install --production
cp .env.example .env && nano .env

# PM2 pour tourner en arrière-plan
npm install -g pm2
pm2 start server.js --name quotly-backend
pm2 startup && pm2 save

# Nginx reverse proxy (port 80/443)
sudo apt install -y nginx certbot python3-certbot-nginx
```

**Fichier Nginx** (`/etc/nginx/sites-available/quotly`) :
```nginx
server {
    server_name api.quotly.fr;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo certbot --nginx -d api.quotly.fr
```

**Coût :** ~4€/mois (Hetzner CX11) ou ~3.5€/mois (OVH VPS Starter)

---

## 🔧 Configuration .env

```env
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://quotly-devis.netlify.app

JWT_SECRET=VOTRE_SECRET_TRES_LONG_ET_ALEATOIRE_MIN_64_CHARS
JWT_EXPIRES_IN=7d

DB_PATH=./data/quotly.db

# Email — Gmail (activer "mots de passe d'application")
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre@gmail.com
SMTP_PASS=xxxx_xxxx_xxxx_xxxx
EMAIL_FROM="Quotly <votre@gmail.com>"

# PayPal
PAYPAL_WEBHOOK_ID=VOTRE_ID_WEBHOOK_PAYPAL
PAYPAL_CLIENT_ID=VOTRE_CLIENT_ID
PAYPAL_CLIENT_SECRET=VOTRE_SECRET
PAYPAL_MODE=live
PAYPAL_PLAN_PRO=SLGH8N66YPCAQ
PAYPAL_PLAN_TEAM=BXFT9S9669PWY
```

---

## 🔗 Connecter le frontend Netlify

Dans le code frontend (quotly-devis.netlify.app), remplacer les appels API par :

```javascript
const API_BASE = 'https://votre-backend.railway.app/api';

// Inscription
const res = await fetch(`${API_BASE}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, email, password })
});

// Connexion
const res = await fetch(`${API_BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
const { token, user } = await res.json();
localStorage.setItem('quotly_token', token);

// Appels authentifiés
const res = await fetch(`${API_BASE}/quotes`, {
  headers: { 'Authorization': `Bearer ${localStorage.getItem('quotly_token')}` }
});
```

---

## 📡 Liste complète des endpoints

### Authentification
| Méthode | URL | Description |
|---|---|---|
| POST | `/api/auth/register` | Créer un compte |
| POST | `/api/auth/login` | Se connecter |
| GET | `/api/auth/me` | Profil + settings |
| PUT | `/api/auth/password` | Changer le mot de passe |
| DELETE | `/api/auth/account` | Supprimer le compte |

### Devis
| Méthode | URL | Description |
|---|---|---|
| GET | `/api/quotes` | Liste des devis (filtres : status, search, page) |
| POST | `/api/quotes` | Créer un devis |
| GET | `/api/quotes/:id` | Détail d'un devis |
| PUT | `/api/quotes/:id` | Modifier un devis |
| DELETE | `/api/quotes/:id` | Supprimer |
| GET | `/api/quotes/:id/pdf` | Télécharger le PDF |
| POST | `/api/quotes/:id/send` | Envoyer par email (Pro+) |
| POST | `/api/quotes/:id/duplicate` | Dupliquer |

### Factures (Pro+)
| Méthode | URL | Description |
|---|---|---|
| GET | `/api/invoices` | Liste des factures |
| POST | `/api/invoices` | Créer une facture |
| POST | `/api/invoices/from-quote/:quoteId` | Convertir devis → facture |
| GET | `/api/invoices/:id/pdf` | PDF facture |
| POST | `/api/invoices/:id/send` | Envoyer par email |
| PUT | `/api/invoices/:id` | Modifier (statut paid, etc.) |

### Signature électronique
| Méthode | URL | Description |
|---|---|---|
| GET | `/api/sign/:token` | Infos devis (public) |
| POST | `/api/sign/:token` | Signer ou refuser (public) |
| GET | `/api/sign/status/:quoteId` | Statut signature (authentifié) |

### Statistiques
| Méthode | URL | Description |
|---|---|---|
| GET | `/api/stats` | Dashboard complet |
| GET | `/api/stats/email-logs` | Historique emails |

### Paramètres
| Méthode | URL | Description |
|---|---|---|
| GET | `/api/settings` | Lire les paramètres |
| PUT | `/api/settings` | Mettre à jour |
| POST | `/api/settings/logo` | Uploader logo (Pro+) |
| GET | `/api/settings/templates` | Liste des templates |

### Équipe (Plan Équipe)
| Méthode | URL | Description |
|---|---|---|
| GET | `/api/team` | Infos équipe + membres |
| POST | `/api/team` | Créer une équipe |
| POST | `/api/team/invite` | Inviter un membre |
| DELETE | `/api/team/members/:id` | Retirer un membre |
| GET | `/api/team/quotes` | Devis de toute l'équipe |

### Webhooks
| Méthode | URL | Description |
|---|---|---|
| POST | `/api/webhooks/paypal` | Webhook PayPal (upgrade plan auto) |
| POST | `/api/webhooks/paypal/activate-manual` | Activation manuelle (support) |

---

## 🔒 Configuration PayPal Webhook

1. Aller sur [developer.paypal.com](https://developer.paypal.com)
2. **My Apps & Credentials → votre app → Webhooks**
3. Ajouter l'URL : `https://votre-api.railway.app/api/webhooks/paypal`
4. Sélectionner les événements :
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
   - `PAYMENT.CAPTURE.COMPLETED`
5. Copier le **Webhook ID** dans votre `.env`

---

## 📧 Configuration email Gmail

1. Aller sur [myaccount.google.com/security](https://myaccount.google.com/security)
2. Activer la **Validation en 2 étapes**
3. Rechercher **"Mots de passe des applications"**
4. Créer un mot de passe pour "Autre (Quotly)"
5. Utiliser ce mot de passe dans `SMTP_PASS`

---

## 🗂️ Structure du projet

```
quotly-backend/
├── server.js              # Point d'entrée Express
├── package.json
├── .env.example
├── db/
│   └── schema.js          # SQLite + schema + helpers
├── middleware/
│   ├── auth.js            # JWT + requirePlan
│   └── planLimits.js      # Limite devis mensuels
├── routes/
│   ├── auth.js            # Inscription / connexion
│   ├── quotes.js          # Devis CRUD + PDF + email
│   ├── invoices.js        # Factures + conversion
│   ├── signatures.js      # Signature électronique
│   ├── stats.js           # Dashboard
│   ├── settings.js        # Paramètres + templates + logo
│   ├── team.js            # Gestion équipe
│   └── webhooks.js        # PayPal webhook
├── services/
│   ├── pdf.js             # Génération PDF professionnelle
│   └── email.js           # Emails HTML Nodemailer
├── data/                  # Base SQLite (auto-créé)
└── uploads/               # Logos entreprises
```

---

## 💡 Conseils pour la mise en production

- **Sauvegardes** : Configurer un cron qui copie `data/quotly.db` vers S3 ou Drive toutes les heures
- **Logs** : Utiliser `pm2 logs` ou configurer Winston pour des logs structurés
- **SMTP** : Passer à Brevo (ex-SendinBlue) gratuit jusqu'à 300 emails/jour
- **SSL** : Obligatoire pour la signature électronique et PayPal
- **Monitoring** : BetterUptime ou UptimeRobot pour les alertes

---

*© 2024 Quotly Backend — Fait avec ♥ en France*
