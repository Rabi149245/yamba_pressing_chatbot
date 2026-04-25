# 🧺 Yamba Pressing Chatbot — Documentation complète

## Structure du projet

```
yamba_pressing_chatbot/
├── server.js                  ← Point d'entrée Express
├── makeService.js             ← Couche Make (queue + callMakeAndWait)
├── whatsappService.js         ← Logique conversationnelle principale
├── orderService.js            ← Catalogue & commandes
├── userService.js             ← États utilisateurs
├── agentsService.js           ← Assignation d'agents
├── humanService.js            ← Escalade humaine
├── pointsService.js           ← Fidélité
├── promoService.js            ← Promotions
├── pickupService.js           ← Ramassage domicile
├── reminderService.js         ← Rappels automatiques
├── feedbackService.js         ← Avis clients
├── notificationsService.js    ← Logs notifications
├── catalogue.json             ← Catalogue des articles (racine)
├── .env.example               ← Modèle des variables d'environnement
├── package.json
└── data/                      ← Dossier créé automatiquement (états locaux)
    ├── user_states.json
    └── orders_log.json        (fallback si Make indisponible)
```

---

## Déploiement sur Render

1. Push le projet sur GitHub
2. Créer un **Web Service** sur Render (Node)
3. Build command : `npm install`
4. Start command : `npm start`
5. Configurer les **Environment Variables** depuis `.env.example`

---

## Variables d'environnement requises

| Variable | Description |
|---|---|
| `WHATSAPP_TOKEN` | Token d'accès WhatsApp Business API |
| `WHATSAPP_PHONE_ID` | ID du numéro WhatsApp Business |
| `VERIFY_TOKEN` | Token de vérification webhook Meta |
| `MAKE_WEBHOOK_URL` | URL du Custom Webhook Make principal |
| `MAKE_API_KEY` | Clé API pour sécuriser les appels Make |
| `MAKE_SIGNATURE_SECRET` | Secret HMAC (optionnel) |
| `ENABLE_REMINDERS` | `true` pour activer les rappels à 9h |
| `DEBUG_MAKE` | `true` pour les logs détaillés |

---

## Routes API

| Méthode | Route | Description |
|---|---|---|
| GET | `/` | Santé du serveur |
| GET | `/catalogue` | Liste des articles |
| GET | `/webhook` | Vérification webhook WhatsApp |
| POST | `/webhook` | Réception messages WhatsApp |
| POST | `/pickup` | Demande de ramassage |
| POST | `/commande` | Créer une commande |
| GET | `/promotions` | Liste des promotions |
| POST | `/promotions` | Ajouter une promotion |
| DELETE | `/promotions/:id` | Supprimer une promotion |
| GET | `/fidelite/:phone` | Solde de points |
| POST | `/fidelite` | Ajouter des points |
| POST | `/feedback` | Enregistrer un avis |
| POST | `/human` | Escalade humaine |
| POST | `/send-whatsapp` | Envoi direct (admin) |

---

## Commandes chatbot disponibles

| Saisie client | Action |
|---|---|
| `1` à `4` | Choisir un service (affiche le catalogue filtré) |
| `5` | Demander un agent humain |
| `N, TYPE, quantité` | Commander directement (ex: `8, NE, 2`) |
| `1_dep` | Confirmer dépôt au pressing |
| `2_pickup` | Confirmer enlèvement à domicile |
| `1_oui` / `2_non` | Avec/sans amidonnage (repassage) |
| `points` | Voir son solde fidélité |
| `promo` | Voir les promotions en cours |
| `avis` | Laisser un feedback |
| `*` ou `✱` | Retour au menu principal |

---

## 📋 SCÉNARIO MAKE — Configuration complète

### Architecture globale

Make reçoit **tous les appels** via **un seul Custom Webhook** avec un Router sur le champ `event`.
Pour les appels nécessitant une réponse (agents, points, promos, rappels), le module **"Respond to webhook"** doit être activé à la fin de chaque branche.

---

### SCÉNARIO 1 — Webhook principal (Router)

**Trigger :** Custom Webhook — URL principale (copiez-la dans `MAKE_WEBHOOK_URL`)

**Sécurisation :** Ajouter un filtre en entrée :
```
Headers["x-make-apikey"] = {{votre MAKE_API_KEY}}
```

**Router → branches selon `{{body.event}}` :**

| Valeur de `event` | Branche |
|---|---|
| `create_order` | → Scénario 2 |
| `Pickups` | → Scénario 3 |
| `escalate_to_human` | → Scénario 4 |
| `incoming_message` | → Scénario 5 |
| `NotificationsLog_add` | → Scénario 6 |
| `Feedbacks_add` | → Scénario 7 |
| `Users_updateLastMessage` | → Scénario 8 |

---

### SCÉNARIO 2 — Commandes (Orders)

**Trigger :** Branche Router `create_order`

**Modules :**
1. **Google Sheets — Add a Row** → Feuille "Commandes"
   - Colonnes : `OrderId` (auto), `ClientPhone`, `ItemsJSON`, `Total`, `Status`, `CreatedAt`
   - `OrderId` = `{{now.timestamp}}`
   - `ItemsJSON` = `{{body.payload.ItemsJSON}}`
   - `Total` = `{{body.payload.Total}}`
   - `Status` = `Pending`
   - `CreatedAt` = `{{body.payload.CreatedAt}}`

---

### SCÉNARIO 3 — Ramassage (Pickups)

**Trigger :** Branche Router `Pickups`

**Modules :**
1. **Google Sheets — Add a Row** → Feuille "Ramassages"
   - Colonnes : `Phone`, `ClientName`, `Lat`, `Lon`, `Address`, `Status`, `CreatedAt`
   - `Status` = `En attente`
2. **Gmail / Email — Send an Email** → Notifier l'équipe
   - Sujet : `🚚 Nouvelle demande de ramassage — {{body.payload.phone}}`
   - Corps : `Client : {{body.payload.phone}}\nAdresse : {{body.payload.address}}`

---

### SCÉNARIO 4 — Escalade humaine

**Trigger :** Branche Router `escalate_to_human`

**Modules :**
1. **Google Sheets — Add a Row** → Feuille "HumanRequests"
   - Colonnes : `Phone`, `ClientName`, `Message`, `Status`, `CreatedAt`
   - `Status` = `Ouvert`
2. **Gmail — Send Email** OU **Slack — Create Message**
   - Notifier l'équipe avec le numéro du client et le message original
3. **Respond to Webhook** → `{ "status": "ok" }`

---

### SCÉNARIO 5 — Log messages entrants

**Trigger :** Branche Router `incoming_message`

**Modules :**
1. **Google Sheets — Add a Row** → Feuille "Messages"
   - Colonnes : `From`, `Body`, `Timestamp`
   - `From` = `{{body.payload.entry[].changes[].value.messages[].from}}`
   - `Body` = `{{body.payload.entry[].changes[].value.messages[].text.body}}`

---

### SCÉNARIO 6 — Log notifications

**Trigger :** Branche Router `NotificationsLog_add`

**Modules :**
1. **Google Sheets — Add a Row** → Feuille "Notifications"
   - Colonnes : `Phone`, `Message`, `MediaUrl`, `Type`, `Ts`

---

### SCÉNARIO 7 — Feedbacks

**Trigger :** Branche Router `Feedbacks_add`

**Modules :**
1. **Google Sheets — Add a Row** → Feuille "Feedbacks"
   - Colonnes : `Phone`, `Message`, `Rating`, `Ts`

---

### SCÉNARIO 8 — Mise à jour dernier message

**Trigger :** Branche Router `Users_updateLastMessage`

**Modules :**
1. **Google Sheets — Search Rows** → Feuille "Clients" — Chercher `Phone = {{body.payload.phone}}`
2. **Router :**
   - Si trouvé → **Update a Row** → `LastMessageAt = {{body.payload.lastMessageAt}}`
   - Si non trouvé → **Add a Row** → Créer le client

---

### SCÉNARIO 9 — Agent disponible (RÉPONSE REQUISE)

**Trigger :** Custom Webhook SÉPARÉ → `Agents_getAvailable`
*(Ce scénario a besoin de retourner des données — webhook séparé recommandé)*

**Modules :**
1. **Google Sheets — Search Rows** → Feuille "Agents"
   - Filtre : `Statut = Disponible`
   - Limite : 1
2. **Google Sheets — Update a Row** → Mettre `Statut = Occupé` pour cet agent
3. **Respond to Webhook** →
```json
{
  "Name": "{{1.Name}}",
  "Phone": "{{1.Phone}}"
}
```

**Structure de la feuille "Agents" :**
| Name | Phone | Statut |
|---|---|---|
| Amadou | +22670000001 | Disponible |
| Fatima | +22670000002 | Disponible |

---

### SCÉNARIO 10 — Solde de points (RÉPONSE REQUISE)

**Trigger :** Custom Webhook SÉPARÉ → `PointsTransactions_get`

**Modules :**
1. **Google Sheets — Search Rows** → Feuille "Points"
   - Filtre : `ClientPhone = {{body.payload.clientPhone}}`
2. **Math — Aggregator** → SUM de la colonne `Points`
3. **Respond to Webhook** →
```json
{
  "points": {{sum}}
}
```

---

### SCÉNARIO 11 — Ajout de points

**Trigger :** Branche Router `PointsTransactions_add`

**Modules :**
1. **Google Sheets — Add a Row** → Feuille "Points"
   - Colonnes : `ClientPhone`, `Points`, `Reason`, `Ts`

---

### SCÉNARIO 12 — Promotions (RÉPONSE REQUISE pour list_promos)

**Trigger :** Custom Webhook SÉPARÉ → `Promotions`

**Router sur `body.payload.action` :**

- **`list_promos`** :
  1. Google Sheets — Search Rows → Feuille "Promotions" (Filtre : `Active = true`)
  2. Respond to Webhook →
  ```json
  [
    {
      "id": "{{item.Id}}",
      "title": "{{item.Title}}",
      "description": "{{item.Description}}",
      "discount": "{{item.Discount}}",
      "validUntil": "{{item.ValidUntil}}"
    }
  ]
  ```

- **`add_promo`** :
  1. Google Sheets — Add a Row → Feuille "Promotions"

- **`remove_promo`** :
  1. Google Sheets — Search Rows → Trouver par `Id`
  2. Google Sheets — Delete a Row

---

### SCÉNARIO 13 — Dernier message client (RÉPONSE REQUISE)

**Trigger :** Custom Webhook SÉPARÉ → `Users_getLastMessage`

**Modules :**
1. **Google Sheets — Search Rows** → Feuille "Clients" — `Phone = {{body.payload.phone}}`
2. **Respond to Webhook** →
```json
{
  "lastMessageAt": "{{1.LastMessageAt}}"
}
```

*(Si client introuvable, retourner `{ "lastMessageAt": null }`)*

---

### SCÉNARIO 14 — Commandes en attente pour rappels (RÉPONSE REQUISE)

**Trigger :** Custom Webhook SÉPARÉ → `get_pending_orders`

**Modules :**
1. **Google Sheets — Search Rows** → Feuille "Commandes"
   - Filtre : `Status = Prêt` ET `Rappel = false`
2. **Respond to Webhook** →
```json
[
  {
    "ClientPhone": "{{item.ClientPhone}}",
    "ClientName": "{{item.ClientName}}",
    "OrderId": "{{item.OrderId}}"
  }
]
```

---

### SCÉNARIO 15 — Marquer comme rappelé

**Trigger :** Branche Router `order_mark_reminded`

**Modules :**
1. **Google Sheets — Search Rows** → Feuille "Commandes" — `OrderId = {{body.payload.orderId}}`
2. **Google Sheets — Update a Row** → `Rappel = true`, `RappelAt = {{now}}`

---

## Structure des feuilles Google Sheets

### Feuille "Commandes"
| OrderId | ClientPhone | ClientName | ItemsJSON | Total | Status | DeliveryOption | Rappel | RappelAt | CreatedAt |
|---|---|---|---|---|---|---|---|---|---|

**Valeurs Status :** `Pending` → `En cours` → `Prêt` → `Livré`

### Feuille "Clients"
| Phone | Name | LastMessageAt | CreatedAt |
|---|---|---|---|

### Feuille "Agents"
| Name | Phone | Statut |
|---|---|---|

**Valeurs Statut :** `Disponible` | `Occupé`

### Feuille "Points"
| ClientPhone | Points | Reason | Ts |
|---|---|---|---|

### Feuille "Promotions"
| Id | Title | Description | Discount | ValidUntil | Active |
|---|---|---|---|---|---|

### Feuille "Ramassages"
| Phone | ClientName | Lat | Lon | Address | Status | CreatedAt |
|---|---|---|---|---|---|---|

### Feuille "HumanRequests"
| Phone | ClientName | Message | Status | CreatedAt |
|---|---|---|---|---|

### Feuille "Feedbacks"
| Phone | Message | Rating | Ts |
|---|---|---|---|

### Feuille "Notifications"
| Phone | Message | MediaUrl | Type | Ts |
|---|---|---|---|---|

### Feuille "Messages"
| From | Body | Timestamp |
|---|---|---|

---

## Notes importantes Make

1. **Webhooks avec réponse** (scénarios 9, 10, 12, 13, 14) : créer des **webhooks séparés** et mettre leurs URLs dans `MAKE_WEBHOOK_URL` n'est pas possible car c'est une seule URL. **Solution recommandée :** utiliser Make avec un Router principal sur l'event, et activer "Respond to webhook" dans chaque branche qui en a besoin.

2. **Sécurisation :** Toujours vérifier le header `x-make-apikey` en entrée de chaque scénario Make.

3. **Timeouts :** Make a un timeout de 40 secondes. Les branches avec réponse doivent être rapides (Google Sheets simple, pas de traitements complexes).

4. **Limites Make Free :** 1 000 opérations/mois. Prévoir un plan payant pour la production.
