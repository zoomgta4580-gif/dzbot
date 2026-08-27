# Discord Shop Bot v3

Enthalten:
- Discord OAuth2 Admin-Dashboard
- mehrere Server im Dashboard
- Verify-System mit Rolle
- Shop-Abteilungen und Produkte
- Aktivieren/Deaktivieren von Abteilungen
- Zahlungsmethoden
- Angebote
- Ticket-System mit Öffnen/Schließen
- Support-Rolle und Ticket-Kategorie
- Shop-/Verify-/Ticket-Design
- Embed-Farbe
- Aktivitätslogs
- Statistiken
- Health Endpoint für Render: `/health`
- API Status Endpoint: `/api/status`
- CSRF-Schutz für Dashboard-Formulare
- OAuth-State-Schutz
- sichere Session-Cookies
- JSON-Speicherung mit atomarem Schreiben

## Render

### Build Command
`npm install`

### Start Command
`npm start`

### Environment Variables

Pflicht:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `REDIRECT_URI`
- `SESSION_SECRET`

Empfohlen:
- `NODE_ENV=production`
- `PORT=10000`
- `COOKIE_SECURE=true`
- `DATA_DIR=/var/data`
- `BOT_STATUS=/help | Shop`

### Render Persistent Disk
Wenn du die JSON-Daten behalten willst, füge deinem Render Service eine Persistent Disk hinzu und mounte sie z.B. unter:

`/var/data`

Dann bleibt `config.json` bei Deploys/Neustarts erhalten.

### Discord OAuth2
In der Discord Developer Portal Application unter OAuth2 Redirects exakt setzen:

`https://DEIN-SERVICE.onrender.com/callback`

`REDIRECT_URI` muss exakt derselbe Wert sein.

### Discord Bot Permissions
Der Bot braucht mindestens:
- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Roles (für Verify)
- Manage Channels (für Tickets)

Die Verify-Rolle muss unter der höchsten Bot-Rolle liegen.

## Wichtig
`DISCORD_TOKEN` und `CLIENT_SECRET` niemals in GitHub, Screenshots oder öffentliche Dateien hochladen.
