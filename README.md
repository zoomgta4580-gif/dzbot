# NOVA SHOP v5

A complete English Discord commerce bot with a large interactive UI.

## Features
- Large English Discord embeds
- Interactive shop dropdowns
- Product dropdown checkout
- Checkout modal
- Automatic order number generation
- Automatic order confirmation
- Order status management: pending / paid / processing / completed / cancelled
- Private support tickets
- Staff roles
- User blacklist
- Verification system
- Payment panel
- Promotional offers
- Shop departments and products
- Modern multi-page web dashboard:
  - Overview
  - Shop
  - Orders
  - Tickets
  - Security
  - Settings
  - Logs
- OAuth2 Discord admin login
- CSRF protection
- OAuth state protection
- Render health endpoint
- Persistent JSON storage

## IMPORTANT: no subfolders
Every application file is in the project root. There are no `src/`, `data/`, or other project subfolders in this package.

## Render
Build command:
`npm install`

Start command:
`npm start`

Required environment variables:
- DISCORD_TOKEN
- CLIENT_ID
- CLIENT_SECRET
- REDIRECT_URI
- SESSION_SECRET

Recommended:
- NODE_ENV=production
- PORT=10000
- COOKIE_SECURE=true
- DATA_DIR=/var/data
- BOT_NAME=NOVA SHOP
- BOT_STATUS=Premium Shop • /shop
- DEFAULT_COLOR=#5865F2

If you want database data to survive Render restarts/deploys, mount a Persistent Disk at `/var/data`.

## Discord OAuth2
Add this exact callback URL in Discord Developer Portal:
`https://YOUR-SERVICE.onrender.com/callback`

It must exactly match `REDIRECT_URI`.

## Bot permissions
Recommended permissions:
- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Roles
- Manage Channels

The verification role must be below the bot's highest role.

## Security
Never publish `DISCORD_TOKEN`, `CLIENT_SECRET`, or `SESSION_SECRET`.
