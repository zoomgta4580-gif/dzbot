# Discord Shop Manager v4

A completely rebuilt English Discord shop bot with a large, modern UI, admin dashboard, tickets, verification, products, categories, payment methods, offers, logs and server configuration.

## Features

- 100% English bot and dashboard messages
- Large Discord embeds with clear sections and spacing
- Button-based verification
- Button-based support tickets
- Ticket category + support role
- Close ticket button
- Shop categories
- Product management
- Payment methods
- Offers / promotions
- Shop statistics
- Activity logs
- Discord OAuth2 admin dashboard
- Server selector
- Render health endpoint
- Persistent JSON storage
- CSRF protection
- OAuth state protection
- Secure production cookies
- Environment-variable based secrets

## Render setup

Build command:
`npm install`

Start command:
`npm start`

Set the variables from `.env.example` in Render.

If you want data to survive redeploys/restarts, attach a Render Persistent Disk and mount it at `/var/data`.

## Discord Developer Portal

Add this exact OAuth redirect URL:
`https://YOUR-SERVICE.onrender.com/callback`

The bot should have:
- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Roles
- Manage Channels

The verification role must be below the bot's highest role.

## Commands

`/setup` - Create a complete starter configuration
`/verify` - Send the verification panel
`/shop` - Send all enabled shop categories
`/payments` - Send payment methods
`/offer` - Send an offer
`/ticket-panel` - Send the support panel
`/stats` - Show shop statistics
`/help` - Show help
`/ping` - Show latency

All visible bot text is English.
