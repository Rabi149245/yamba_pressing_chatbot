Yamba Pressing Chatbot - Final version (Render + Make + Google Sheets)

Structure:
- server.js : main entry (endpoints: /catalogue, /webhook, /pickup, /commande, /promotions, /fidelite, admin endpoints)
- services/makeService.js : forwards events to Make webhook
- services/orderService.js : reads catalogue (data/catalogue.json) and computes prices
- services/whatsappService.js : WhatsApp message handling and forwarding
- services/reminderService.js : triggers reminder checks (cron -> Make)

Deployment:
1) Push this project to GitHub.
2) Create a Web Service on Render (Node).
3) Build: npm install
4) Start: npm start
5) Set environment variables from .env.example in Render dashboard.

Security:
- APP_API_KEY protects /pickup, /commande, /promotions, /fidelite, /human and
  /send-whatsapp. Callers must send it in the `x-api-key` header. Without it
  configured, these routes refuse every request (fail closed).
- WHATSAPP_APP_SECRET is required to validate the `X-Hub-Signature-256`
  header Meta sends on every WhatsApp webhook call. Without it configured,
  /webhook refuses every incoming message.

Make scenario:
- Create a custom webhook on Make to receive events from this Node app.
- Make should handle: create_order, create_pickup, create_promo, mark_ready, get_points, list_orders, get_pending_orders, confirm_last
- Use Google Sheets modules to persist clients, orders, promotions and pickup locations.
- Read-type events (PointsTransactions_get, Agents_getAvailable, Promotions_list,
  get_pending_orders) must respond synchronously with the actual data — these
  are sent via a direct HTTP call (queryMakeWebhook), not the fire-and-forget
  event queue used for writes.
