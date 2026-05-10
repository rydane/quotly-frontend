# 📤 Comment uploader DEFACT Backend sur GitHub

## Méthode rapide (tout en ligne, pas de Git en local)

1. **Crée un repo sur GitHub**
   - Va sur https://github.com/new
   - Nom : `defact-backend`
   - Privé (recommandé pour le moment)
   - **Ne coche RIEN** (pas de README, pas de .gitignore, pas de license — on a déjà tout)
   - Clique "Create repository"

2. **Upload le contenu du dossier `backend/`**
   - Sur la page du repo vide, clique "uploading an existing file"
   - Ouvre le dossier `backend/` sur ton ordinateur
   - **Sélectionne TOUT le contenu** (mais PAS le dossier lui-même) :
     - `server.js`
     - `package.json`
     - `migrate.js`
     - `.gitignore`
     - `.env.example`
     - `README.md`
     - `HOW_TO_GITHUB.md` (ce fichier)
     - dossiers : `db/`, `routes/`, `services/`, `middleware/`
   - **NE JAMAIS uploader** : `node_modules/` ni `.env` (s'il existe)
   - Drag & drop dans la zone GitHub
   - Commit message : `Initial commit DEFACT v2.1`
   - Clique "Commit changes"

3. **Connecte ton repo à Render**
   - Va sur https://render.com → New + → Web Service
   - Connect GitHub → autorise Render → choisis `defact-backend`
   - Remplis :
     - Name : `defact-backend`
     - Region : Frankfurt (le plus proche de la France)
     - Branch : `main`
     - Build command : `npm install`
     - Start command : `node server.js`
     - Plan : Free (pour commencer)
   - **Avant de cliquer "Create Web Service"** : descend dans "Environment Variables"
     - Ajoute toutes les variables de `.env.example` une par une avec leurs vraies valeurs
     - **`DATABASE_URL`** : prends-la dans Supabase (Settings → Database → Connection string → URI mode)
     - **`JWT_SECRET`** : génère une chaîne aléatoire avec :
       ```
       node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
       ```
   - Crée le service → attends 3-5 minutes
   - Visite l'URL Render (ex: `https://defact-backend.onrender.com/health`) → tu dois voir `{"status":"ok"}`

4. **Mets à jour le frontend**
   - Dans `index.html` ligne 175, remplace :
     ```js
     const API = 'https://quotly-backend.onrender.com/api';
     ```
     par :
     ```js
     const API = 'https://defact-backend.onrender.com/api';   // ton URL Render
     ```
   - Re-déploie sur Vercel

---

## Méthode Git (si tu veux apprendre)

```bash
cd backend/
git init
git add .
git commit -m "Initial commit DEFACT v2.1"
git branch -M main
git remote add origin https://github.com/TON_USERNAME/defact-backend.git
git push -u origin main
```

Si tu n'as jamais utilisé Git : la méthode "tout en ligne" ci-dessus est plus simple pour démarrer.

---

## ⚠️ Sécurité — À NE JAMAIS faire

- ❌ Commit le fichier `.env` (contient tes secrets)
- ❌ Mettre `JWT_SECRET` ou `DATABASE_URL` dans le code source
- ❌ Rendre le repo public tant que tu n'as pas vérifié 2x qu'aucun secret ne traîne dedans

Le `.gitignore` que j'ai inclus protège déjà `.env` et `node_modules/` — donc si tu suis la procédure normale, tu es safe.
