'use strict';
/**
 * Intégration PDP (Plateforme Agréée DGFiP) — STUB
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  ⚠️  CE FICHIER EST UN STUB. Il ne fait RIEN en production. Avant que la
 *  conversion en facture soit légalement valide pour le B2B (à partir du
 *  1er septembre 2026), tu dois :
 *
 *  1. Choisir un partenaire PDP. Options recommandées pour ta cible (TPE/freelances) :
 *     - Tiime  (https://www.tiime.fr)   — gratuit, API documentée, déjà PA certifié
 *     - Abby   (https://abby.fr)         — freemium, partenaire URSSAF
 *     - Sellsy (https://www.sellsy.com)  — payant mais API très complète
 *     - Pennylane (https://www.pennylane.com) — orienté TPE/PME
 *
 *  2. Contacter leur équipe partenariats. Pour une intégration "white-label" où
 *     DEFACT reste le frontend et le PDP émet la facture en arrière-plan, c'est
 *     un partenariat commercial (pas juste une clé API). Compter 4-12 semaines
 *     de négociation et de validation technique. Mention "via partenaire X" sur
 *     le site est généralement requise.
 *
 *  3. Une fois le partenariat signé, ils te donneront :
 *     - Une clé API (à mettre dans .env : PDP_API_KEY)
 *     - Une URL d'endpoint (PDP_API_URL)
 *     - Un identifiant marchand (PDP_MERCHANT_ID)
 *     - Un format Factur-X (XML embarqué dans le PDF) à respecter
 *
 *  4. Implémenter les fonctions ci-dessous en remplaçant les stubs par de vrais
 *     appels HTTP. La structure est déjà là pour faciliter le branchement.
 *
 *  En attendant, l'app fonctionne mais "Convertir en facture" :
 *    - génère bien une facture côté DEFACT (table invoices)
 *    - PRÉCISE clairement à l'utilisateur que la facture n'est PAS encore
 *      transmise à une PDP (donc pas opposable B2B post-2026/2027)
 *  → C'est légal aujourd'hui (mai 2026), ça ne le sera plus pour B2B le 1er sept 2026.
 *  → Pour B2C (particuliers) ça reste valable même après septembre 2026.
 */

const PDP_PROVIDER = process.env.PDP_PROVIDER || 'none'; // 'none' | 'tiime' | 'abby' | 'sellsy'
const PDP_API_URL  = process.env.PDP_API_URL  || '';
const PDP_API_KEY  = process.env.PDP_API_KEY  || '';

/**
 * Soumet une facture au PDP partenaire pour émission officielle.
 *
 * @param {Object} invoice - L'objet facture de la base DEFACT
 * @param {Object} issuer - Les coordonnées de l'émetteur (settings utilisateur)
 *                          { company_name, company_address, siret, tva, ... }
 * @returns {Promise<{success, pdp_id?, error?}>}
 */
async function submitInvoiceToPDP(invoice, issuer) {
  if (PDP_PROVIDER === 'none' || !PDP_API_KEY) {
    // Mode stub : pas de partenaire configuré
    return {
      success: false,
      error: 'PDP non configurée — facture émise en mode local uniquement (B2C OK, B2B non opposable post-09/2026).',
      mode: 'stub',
    };
  }

  // ───────────────────────────────────────────────────────────────────
  // À REMPLIR quand le partenariat est signé. Exemple générique :
  // ───────────────────────────────────────────────────────────────────
  // try {
  //   const payload = {
  //     issuer: { siret: issuer.siret, name: issuer.company_name, /* ... */ },
  //     recipient: { name: invoice.client_name, email: invoice.client_email /* ... */ },
  //     items: invoice.items,
  //     currency: 'EUR',
  //     tva_rate: invoice.tva_rate,
  //     // Format : Factur-X (PDF/A-3 + XML CII embarqué)
  //   };
  //   const res = await fetch(`${PDP_API_URL}/invoices`, {
  //     method: 'POST',
  //     headers: {
  //       'Authorization': `Bearer ${PDP_API_KEY}`,
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify(payload),
  //   });
  //   if (!res.ok) {
  //     const err = await res.text();
  //     return { success: false, error: `PDP ${res.status}: ${err}` };
  //   }
  //   const data = await res.json();
  //   return { success: true, pdp_id: data.id, status: data.status };
  // } catch (err) {
  //   return { success: false, error: err.message };
  // }

  return { success: false, error: 'Implémentation PDP à compléter.', mode: 'stub' };
}

/**
 * Récupère le statut d'une facture déjà soumise au PDP
 * (pour mettre à jour les statuts dans DEFACT : sent → received → paid)
 */
async function getPDPInvoiceStatus(pdp_id) {
  if (PDP_PROVIDER === 'none' || !PDP_API_KEY) {
    return { success: false, error: 'PDP non configurée', mode: 'stub' };
  }
  // À implémenter selon l'API du PDP choisi
  return { success: false, error: 'Implémentation à compléter.', mode: 'stub' };
}

/**
 * Indique au frontend si l'intégration PDP est active.
 * Sert à afficher / cacher un avertissement "B2B non opposable".
 */
function isPDPConfigured() {
  return PDP_PROVIDER !== 'none' && Boolean(PDP_API_KEY);
}

module.exports = {
  submitInvoiceToPDP,
  getPDPInvoiceStatus,
  isPDPConfigured,
  PDP_PROVIDER,
};
