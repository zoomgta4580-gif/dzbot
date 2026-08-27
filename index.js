require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
} = require("discord.js");

// ============================================================
// ENV / STARTUP
// ============================================================
const REQUIRED_ENV = [
  "DISCORD_TOKEN",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "REDIRECT_URI",
  "SESSION_SECRET",
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error("❌ Fehlende Render Environment Variables:", missingEnv.join(", "));
  console.error("   Siehe .env.example");
}

const PORT = Number(process.env.PORT || 10000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "config.json");
const NODE_ENV = process.env.NODE_ENV || "production";
const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === "true"
  : NODE_ENV === "production";

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "{}");

let db = {};
try {
  db = JSON.parse(fs.readFileSync(FILE, "utf8") || "{}");
} catch (err) {
  console.error("❌ config.json konnte nicht gelesen werden:", err);
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.error("❌ Speichern fehlgeschlagen:", err);
    }
  }, 150);
}

function clamp(value, max) {
  return String(value ?? "").slice(0, max);
}

function id() {
  return crypto.randomUUID();
}

function defaultConfig() {
  return {
    verifyRoleId: null,
    verifyChannelId: null,
    paymentChannelId: null,
    ticketCategoryId: null,
    ticketSupportRoleId: null,
    verifyTitle: "🔐 Server-Verifizierung",
    verifyDescription: "Klicke auf den Button, um dich zu verifizieren.",
    ticketTitle: "🎫 Support",
    ticketDescription: "Klicke auf den Button, um ein Support-Ticket zu eröffnen.",
    shopTitle: "🛒 Unser Shop",
    shopDescription: "Unsere aktuellen Produkte und Abteilungen.",
    brandColor: "#5865F2",
    categories: [],
    payments: [],
    offers: [],
    tickets: [],
    logs: [],
  };
}

function cfg(guildId) {
  if (!db[guildId]) db[guildId] = defaultConfig();
  const c = db[guildId];
  const defaults = defaultConfig();

  for (const [key, value] of Object.entries(defaults)) {
    if (c[key] === undefined) c[key] = Array.isArray(value) ? [] : value;
  }
  if (!Array.isArray(c.categories)) c.categories = [];
  if (!Array.isArray(c.payments)) c.payments = [];
  if (!Array.isArray(c.offers)) c.offers = [];
  if (!Array.isArray(c.tickets)) c.tickets = [];
  if (!Array.isArray(c.logs)) c.logs = [];

  for (const cat of c.categories) {
    if (!Array.isArray(cat.products)) cat.products = [];
    if (cat.enabled === undefined) cat.enabled = true;
  }
  return c;
}

function logAction(guildId, action, user, extra = {}) {
  const c = cfg(guildId);
  c.logs.unshift({
    id: id(),
    action: clamp(action, 100),
    userId: user?.id || "system",
    userName: clamp(user?.username || "System", 100),
    at: Date.now(),
    ...extra,
  });
  c.logs = c.logs.slice(0, 200);
  save();
}

function admin(interaction) {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
}

function safeUrl(value) {
  try {
    const u = new URL(String(value));
    return ["http:", "https:"].includes(u.protocol) ? u.toString() : "";
  } catch {
    return "";
  }
}

function hexColor(value) {
  const v = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#5865F2";
}

function categoryEmbed(c, global) {
  const e = new EmbedBuilder()
    .setColor(hexColor(global.brandColor))
    .setTitle(clamp(`${c.emoji || "📦"} ${c.name}`, 256))
    .setDescription(clamp(c.description || "Unsere aktuellen Produkte.", 4096))
    .setFooter({ text: clamp(c.footer || "Interesse? Eröffne ein Ticket.", 2048) })
    .setTimestamp();

  for (const p of (c.products || []).filter((x) => x.enabled !== false).slice(0, 25)) {
    e.addFields({
      name: clamp(`${p.emoji || "✦"} ${p.name} • ${p.price}`, 256),
      value: clamp(p.description || "Keine Beschreibung.", 1024),
      inline: p.inline !== false,
    });
  }

  const image = safeUrl(c.image);
  if (image) e.setImage(image);
  return e;
}

function paymentEmbed(c) {
  const e = new EmbedBuilder()
    .setColor(hexColor(c.brandColor))
    .setTitle("💳 Zahlungsmethoden")
    .setDescription(clamp("Wir akzeptieren folgende Zahlungsmethoden:", 4096))
    .setTimestamp();

  for (const p of c.payments.slice(0, 25)) {
    e.addFields({
      name: clamp(`${p.emoji || "•"} ${p.name}`, 256),
      value: clamp(p.description || "Verfügbar.", 1024),
      inline: true,
    });
  }
  return e;
}

function verifyMessage(c) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_button")
      .setLabel("Jetzt verifizieren")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(hexColor(c.brandColor))
        .setTitle(clamp(c.verifyTitle, 256))
        .setDescription(clamp(c.verifyDescription, 4096))
        .setTimestamp(),
    ],
    components: [row],
  };
}

function ticketMessage(c) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_open")
      .setLabel("Ticket eröffnen")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary)
  );
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(hexColor(c.brandColor))
        .setTitle(clamp(c.ticketTitle, 256))
        .setDescription(clamp(c.ticketDescription, 4096))
        .setTimestamp(),
    ],
    components: [row],
  };
}

const commands = [
  new SlashCommandBuilder().setName("verify").setDescription("Postet die Verify-Nachricht."),
  new SlashCommandBuilder().setName("shop").setDescription("Postet alle aktiven Shop-Abteilungen."),
  new SlashCommandBuilder()
    .setName("angebot")
    .setDescription("Postet ein Angebot.")
    .addStringOption((o) => o.setName("name").setDescription("Name").setRequired(true))
    .addStringOption((o) => o.setName("preis").setDescription("Preis").setRequired(true))
    .addStringOption((o) => o.setName("beschreibung").setDescription("Beschreibung").setRequired(false)),
  new SlashCommandBuilder().setName("zahlung").setDescription("Postet Zahlungsmethoden."),
  new SlashCommandBuilder().setName("ticketpanel").setDescription("Postet das Ticket-Panel."),
  new SlashCommandBuilder().setName("stats").setDescription("Zeigt Shop-Statistiken."),
  new SlashCommandBuilder().setName("ping").setDescription("Bot-Latenz."),
  new SlashCommandBuilder().setName("help").setDescription("Hilfe."),
].map((x) => x.toJSON());

// ============================================================
// DISCORD BOT
// ============================================================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once("ready", async () => {
  console.log(`✅ Discord online als ${client.user.tag}`);
  client.user.setActivity(process.env.BOT_STATUS || "/help | Shop");

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✅ Slash-Commands registriert.");
  } catch (err) {
    console.error("❌ Slash-Commands konnten nicht registriert werden:", err);
  }
});

client.on("error", (err) => console.error("❌ Discord Client:", err));
client.on("shardError", (err) => console.error("❌ Discord Shard:", err));

async function openTicket(interaction) {
  const c = cfg(interaction.guild.id);
  const guild = interaction.guild;

  const existing = guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildText &&
      c.tickets.some((t) => t.channelId === ch.id && t.userId === interaction.user.id && !t.closedAt)
  );

  if (existing) {
    return interaction.reply({
      content: `🎫 Du hast bereits ein offenes Ticket: <#${existing.id}>`,
      ephemeral: true,
    });
  }

  const safeName = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .slice(0, 18);

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
      ],
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
      ],
    },
  ];

  if (c.ticketSupportRoleId) {
    overwrites.push({
      id: c.ticketSupportRoleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: `ticket-${safeName}-${Date.now().toString().slice(-4)}`,
    type: ChannelType.GuildText,
    parent: c.ticketCategoryId || undefined,
    permissionOverwrites: overwrites,
    topic: `Support-Ticket von ${interaction.user.tag}`,
  });

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Ticket schließen")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@${interaction.user.id}>${c.ticketSupportRoleId ? ` <@&${c.ticketSupportRoleId}>` : ""}`,
    embeds: [
      new EmbedBuilder()
        .setColor(hexColor(c.brandColor))
        .setTitle("🎫 Ticket geöffnet")
        .setDescription("Beschreibe hier dein Anliegen. Ein Teammitglied wird sich darum kümmern.")
        .setTimestamp(),
    ],
    components: [closeRow],
  });

  c.tickets.push({
    id: id(),
    channelId: channel.id,
    userId: interaction.user.id,
    userName: interaction.user.tag,
    createdAt: Date.now(),
  });
  logAction(guild.id, "Ticket eröffnet", interaction.user, { channelId: channel.id });
  await interaction.reply({ content: `✅ Ticket erstellt: <#${channel.id}>`, ephemeral: true });
}

async function closeTicket(interaction) {
  const c = cfg(interaction.guild.id);
  const ticket = c.tickets.find((t) => t.channelId === interaction.channelId && !t.closedAt);

  if (!ticket) {
    return interaction.reply({ content: "❌ Dieses Ticket ist nicht registriert.", ephemeral: true });
  }

  const isOwner = ticket.userId === interaction.user.id;
  if (!isOwner && !admin(interaction) && !(c.ticketSupportRoleId && interaction.member.roles.cache.has(c.ticketSupportRoleId))) {
    return interaction.reply({ content: "❌ Du darfst dieses Ticket nicht schließen.", ephemeral: true });
  }

  ticket.closedAt = Date.now();
  logAction(interaction.guild.id, "Ticket geschlossen", interaction.user, { channelId: interaction.channelId });

  await interaction.reply("🔒 Ticket wird in 5 Sekunden geschlossen.");
  setTimeout(() => interaction.channel.delete("Ticket geschlossen").catch(() => {}), 5000);
}

client.on("interactionCreate", async (i) => {
  try {
    if (!i.guild) return;

    if (i.isButton()) {
      if (i.customId === "verify_button") {
        const c = cfg(i.guild.id);
        if (!c.verifyRoleId) return i.reply({ content: "❌ Keine Verify-Rolle eingerichtet.", ephemeral: true });

        const member = await i.guild.members.fetch(i.user.id);
        const role = i.guild.roles.cache.get(c.verifyRoleId);
        if (!role) return i.reply({ content: "❌ Verify-Rolle nicht gefunden.", ephemeral: true });

        if (role.position >= i.guild.members.me.roles.highest.position) {
          return i.reply({ content: "❌ Die Verify-Rolle muss unter der höchsten Bot-Rolle liegen.", ephemeral: true });
        }

        await member.roles.add(role);
        logAction(i.guild.id, "Mitglied verifiziert", i.user);
        return i.reply({ content: "✅ Du bist verifiziert.", ephemeral: true });
      }

      if (i.customId === "ticket_open") return openTicket(i);
      if (i.customId === "ticket_close") return closeTicket(i);
      return;
    }

    if (!i.isChatInputCommand()) return;

    if (["verify", "shop", "angebot", "zahlung", "ticketpanel"].includes(i.commandName) && !admin(i)) {
      return i.reply({ content: "❌ Nur Server-Administratoren dürfen diesen Command benutzen.", ephemeral: true });
    }

    const c = cfg(i.guild.id);

    if (i.commandName === "ping") {
      return i.reply(`🏓 Pong! ${client.ws.ping}ms`);
    }

    if (i.commandName === "help") {
      return i.reply({
        content:
          "`/verify` Verify posten\n`/shop` Shop posten\n`/angebot` Angebot posten\n`/zahlung` Zahlungen posten\n`/ticketpanel` Ticket-Panel posten\n`/stats` Statistiken\n`/ping` Latenz",
        ephemeral: true,
      });
    }

    if (i.commandName === "stats") {
      const products = c.categories.reduce((n, x) => n + x.products.length, 0);
      const openTickets = c.tickets.filter((t) => !t.closedAt).length;
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(hexColor(c.brandColor))
            .setTitle("📊 Shop-Statistik")
            .addFields(
              { name: "📁 Abteilungen", value: String(c.categories.length), inline: true },
              { name: "📦 Produkte", value: String(products), inline: true },
              { name: "💳 Zahlungen", value: String(c.payments.length), inline: true },
              { name: "🔥 Angebote", value: String(c.offers.length), inline: true },
              { name: "🎫 Offene Tickets", value: String(openTickets), inline: true },
              { name: "📝 Logs", value: String(c.logs.length), inline: true },
            ),
        ],
        ephemeral: true,
      });
    }

    if (i.commandName === "verify") {
      const ch = c.verifyChannelId ? i.guild.channels.cache.get(c.verifyChannelId) : i.channel;
      if (!ch?.isTextBased()) return i.reply({ content: "❌ Verify-Channel fehlt.", ephemeral: true });
      await ch.send(verifyMessage(c));
      logAction(i.guild.id, "Verify-Panel gepostet", i.user, { channelId: ch.id });
      return i.reply({ content: `✅ In <#${ch.id}> gepostet.`, ephemeral: true });
    }

    if (i.commandName === "shop") {
      const active = c.categories.filter((x) => x.enabled !== false);
      if (!active.length) return i.reply({ content: "❌ Keine aktiven Abteilungen.", ephemeral: true });

      let count = 0;
      for (const category of active) {
        const ch = i.guild.channels.cache.get(category.channelId);
        if (ch?.isTextBased()) {
          await ch.send({ embeds: [categoryEmbed(category, c)] });
          count++;
        }
      }
      logAction(i.guild.id, "Shop gepostet", i.user, { count });
      return i.reply({ content: `✅ ${count} Abteilungen gepostet.`, ephemeral: true });
    }

    if (i.commandName === "zahlung") {
      const ch = c.paymentChannelId ? i.guild.channels.cache.get(c.paymentChannelId) : i.channel;
      if (!ch?.isTextBased()) return i.reply({ content: "❌ Zahlungs-Channel fehlt.", ephemeral: true });
      await ch.send({ embeds: [paymentEmbed(c)] });
      logAction(i.guild.id, "Zahlungen gepostet", i.user, { channelId: ch.id });
      return i.reply({ content: `✅ In <#${ch.id}> gepostet.`, ephemeral: true });
    }

    if (i.commandName === "ticketpanel") {
      const ch = c.verifyChannelId ? i.guild.channels.cache.get(c.verifyChannelId) : i.channel;
      if (!ch?.isTextBased()) return i.reply({ content: "❌ Kein gültiger Channel.", ephemeral: true });
      await ch.send(ticketMessage(c));
      logAction(i.guild.id, "Ticket-Panel gepostet", i.user, { channelId: ch.id });
      return i.reply({ content: `✅ Ticket-Panel in <#${ch.id}> gepostet.`, ephemeral: true });
    }

    if (i.commandName === "angebot") {
      const chId = c.categories.find((x) => x.isOffer)?.channelId || c.paymentChannelId || i.channelId;
      const ch = i.guild.channels.cache.get(chId);
      if (!ch?.isTextBased()) return i.reply({ content: "❌ Angebots-Channel fehlt.", ephemeral: true });

      const name = i.options.getString("name");
      const price = i.options.getString("preis");
      const description = i.options.getString("beschreibung") || "Keine Beschreibung.";

      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(hexColor(c.brandColor))
            .setTitle(clamp(`🔥 ${name}`, 256))
            .setDescription(clamp(description, 4096))
            .addFields({ name: "💰 Angebotspreis", value: clamp(price, 1024), inline: true })
            .setFooter({ text: "✨ Aktuelles Angebot" })
            .setTimestamp(),
        ],
      });

      c.offers.unshift({ id: id(), name, price, description, createdAt: Date.now() });
      logAction(i.guild.id, "Angebot gepostet", i.user, { name });
      return i.reply({ content: `✅ Angebot in <#${ch.id}> gepostet.`, ephemeral: true });
    }
  } catch (err) {
    console.error("❌ Discord Interaction:", err);
    if (!i.replied && !i.deferred) {
      await i.reply({ content: "❌ Es ist ein Fehler aufgetreten. Prüfe die Render-Logs.", ephemeral: true }).catch(() => {});
    }
  }
});

// ============================================================
// EXPRESS DASHBOARD
// ============================================================
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: true, limit: "50kb" }));
app.use(express.json({ limit: "50kb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "invalid-development-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      httpOnly: true,
    },
  })
);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

function csrf(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString("hex");
  return req.session.csrf;
}

function checkCsrf(req) {
  return Boolean(req.session.csrf && req.body._csrf && req.body._csrf === req.session.csrf);
}

function logged(req, res, next) {
  if (req.session.user) return next();
  return res.redirect("/login");
}

function allowed(req, guildId) {
  return Boolean(req.session.guilds?.some((g) => g.id === guildId));
}

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function opts(items, selected) {
  return items
    .map((x) => `<option value="${esc(x.id)}" ${x.id === selected ? "selected" : ""}>${esc(x.name)}</option>`)
    .join("");
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    discordReady: client.isReady(),
    uptime: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

app.get("/api/status", logged, wrap(async (req, res) => {
  const guilds = req.session.guilds || [];
  res.json({
    ok: true,
    user: req.session.user,
    guilds,
    botGuilds: client.guilds.cache.size,
  });
}));

app.get("/", (req, res) => res.redirect(req.session.user ? "/dashboard" : "/login"));

app.get("/login", (req, res) => {
  if (missingEnv.length) {
    return res.status(500).send(page("Konfiguration fehlt", `<h1>⚠️ Render-Konfiguration fehlt</h1><p>${esc(missingEnv.join(", "))}</p>`));
  }

  req.session.oauthState = crypto.randomBytes(24).toString("hex");
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    redirect_uri: process.env.REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
    state: req.session.oauthState,
  });
  res.redirect("https://discord.com/oauth2/authorize?" + params);
});

app.get("/callback", wrap(async (req, res) => {
  if (!req.query.code || !req.query.state || req.query.state !== req.session.oauthState) {
    return res.status(400).send(page("OAuth-Fehler", "<h1>❌ Ungültiger OAuth-Status.</h1><p>Bitte erneut anmelden.</p>"));
  }

  const body = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    grant_type: "authorization_code",
    code: req.query.code,
    redirect_uri: process.env.REDIRECT_URI,
  });

  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = await tokenResponse.json();

  if (!token.access_token) {
    console.error("❌ OAuth Token:", token);
    return res.status(400).send(page("OAuth-Fehler", "<h1>❌ Discord OAuth fehlgeschlagen.</h1>"));
  }

  const headers = { Authorization: `Bearer ${token.access_token}` };
  const userResponse = await fetch("https://discord.com/api/users/@me", { headers });
  const guildResponse = await fetch("https://discord.com/api/users/@me/guilds", { headers });

  const user = await userResponse.json();
  const guilds = await guildResponse.json();

  req.session.user = user;
  req.session.guilds = Array.isArray(guilds)
    ? guilds.filter((g) => (Number(g.permissions) & 8) === 8)
    : [];

  delete req.session.oauthState;
  req.session.csrf = crypto.randomBytes(24).toString("hex");

  res.redirect("/dashboard");
}));

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

function dashboard(g, c, channels, roles, guilds, botInGuild, req) {
  const products = c.categories.reduce((n, x) => n + x.products.length, 0);
  const openTickets = c.tickets.filter((t) => !t.closedAt).length;
  const token = csrf(req);

  return page(
    "Shop Control",
    `
<header>
  <div><h1>🛒 Shop Control</h1><p>${esc(g.name)} · Admin Dashboard</p></div>
  <a class="btn ghost" href="/logout">Logout</a>
</header>

<nav>${guilds.map((x) => `<a class="${x.id === g.id ? "active" : ""}" href="/dashboard?guild=${x.id}">${esc(x.name)}</a>`).join("")}</nav>

${botInGuild ? "" : `<div class="panel warning"><b>⚠️ Bot nicht auf diesem Server.</b><p>Der Server ist in deinem Discord-Konto sichtbar, aber der Bot ist dort nicht aktiv.</p></div>`}

<div class="hero">
  <span>● LIVE CONTROL</span>
  <h2>${esc(c.shopTitle)}</h2>
  <p>${esc(c.shopDescription)}</p>
  <div class="stats">
    <div><b>${c.categories.length}</b><small>Abteilungen</small></div>
    <div><b>${products}</b><small>Produkte</small></div>
    <div><b>${c.payments.length}</b><small>Zahlungen</small></div>
    <div><b>${openTickets}</b><small>Offene Tickets</small></div>
  </div>
</div>

<section class="grid">
  <div class="panel">
    <h2>🎨 Shop Design</h2>
    <form method="POST" action="/settings">
      <input type="hidden" name="_csrf" value="${token}">
      <input type="hidden" name="guild" value="${g.id}">
      <label>Shop-Titel</label><input name="shopTitle" value="${esc(c.shopTitle)}">
      <label>Shop-Beschreibung</label><textarea name="shopDescription">${esc(c.shopDescription)}</textarea>
      <label>Embed-Farbe</label><input name="brandColor" value="${esc(c.brandColor)}" placeholder="#5865F2">
      <label>Verify-Titel</label><input name="verifyTitle" value="${esc(c.verifyTitle)}">
      <label>Verify-Text</label><textarea name="verifyDescription">${esc(c.verifyDescription)}</textarea>
      <button class="btn">Speichern</button>
    </form>
  </div>

  <div class="panel">
    <h2>🔐 Verify</h2>
    <form method="POST" action="/settings">
      <input type="hidden" name="_csrf" value="${token}">
      <input type="hidden" name="guild" value="${g.id}">
      <label>Verify-Channel</label><select name="verifyChannelId"><option value="">Aktueller Channel</option>${opts(channels, c.verifyChannelId)}</select>
      <label>Verify-Rolle</label><select name="verifyRoleId"><option value="">Keine Rolle</option>${roles.map((x) => `<option value="${x.id}" ${x.id === c.verifyRoleId ? "selected" : ""}>@${esc(x.name)}</option>`).join("")}</select>
      <button class="btn">Speichern</button>
    </form>
    <form method="POST" action="/post-verify"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><button class="btn ghost">📤 Verify posten</button></form>
  </div>

  <div class="panel">
    <h2>🎫 Tickets</h2>
    <form method="POST" action="/settings">
      <input type="hidden" name="_csrf" value="${token}">
      <input type="hidden" name="guild" value="${g.id}">
      <label>Ticket-Kategorie</label><select name="ticketCategoryId"><option value="">Keine</option>${opts(channels.filter((x) => x.type === "category"), c.ticketCategoryId)}</select>
      <label>Support-Rolle</label><select name="ticketSupportRoleId"><option value="">Keine</option>${roles.map((x) => `<option value="${x.id}" ${x.id === c.ticketSupportRoleId ? "selected" : ""}>@${esc(x.name)}</option>`).join("")}</select>
      <label>Panel-Titel</label><input name="ticketTitle" value="${esc(c.ticketTitle)}">
      <label>Panel-Text</label><textarea name="ticketDescription">${esc(c.ticketDescription)}</textarea>
      <button class="btn">Speichern</button>
    </form>
    <form method="POST" action="/post-ticket-panel"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><button class="btn ghost">📤 Ticket-Panel posten</button></form>
  </div>

  <div class="panel">
    <h2>💳 Zahlungen</h2>
    <form method="POST" action="/settings">
      <input type="hidden" name="_csrf" value="${token}">
      <input type="hidden" name="guild" value="${g.id}">
      <label>Zahlungs-Channel</label><select name="paymentChannelId"><option value="">Keiner</option>${opts(channels.filter((x) => x.type === "text"), c.paymentChannelId)}</select>
      <button class="btn">Channel speichern</button>
    </form>
    ${c.payments.map((p) => `<div class="item"><span>${esc(p.emoji)} <b>${esc(p.name)}</b><small>${esc(p.description)}</small></span><form method="POST" action="/payment/delete"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="paymentId" value="${p.id}"><button class="danger">Löschen</button></form></div>`).join("")}
    <form method="POST" action="/payment" class="compact"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input name="emoji" value="💳"><input name="name" placeholder="PayPal / Überweisung" required><input name="description" placeholder="Beschreibung"><button class="btn">+ Methode</button></form>
    <form method="POST" action="/post-payments"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><button class="btn ghost">📤 Posten</button></form>
  </div>
</section>

<section class="panel">
  <h2>📁 Abteilungen & Produkte</h2>
  <div class="cats">
  ${c.categories.map((cat) => `
    <article>
      <div class="cathead"><h3>${esc(cat.emoji)} ${esc(cat.name)}</h3><small>${cat.products.length} Produkte</small></div>
      <p>${esc(cat.description)}</p>
      <p>📺 ${cat.channelId ? `<#${cat.channelId}>` : "Kein Channel"} · ${cat.enabled === false ? "⏸️ deaktiviert" : "🟢 aktiv"}</p>
      ${cat.products.map((p) => `
        <div class="item">
          <span>${esc(p.emoji)} <b>${esc(p.name)}</b><small>${esc(p.price)} · ${esc(p.description)}</small></span>
          <form method="POST" action="/product/delete"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="categoryId" value="${cat.id}"><input type="hidden" name="productId" value="${p.id}"><button class="danger">Löschen</button></form>
        </div>`).join("")}
      <form method="POST" action="/product" class="compact">
        <input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="categoryId" value="${cat.id}">
        <input name="emoji" value="✦"><input name="name" placeholder="Produkt" required><input name="price" placeholder="9,99 €" required><input name="description" placeholder="Beschreibung"><button class="btn">+ Produkt</button>
      </form>
      <div class="actions">
        <form method="POST" action="/post-category"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="categoryId" value="${cat.id}"><button class="btn">📤 Posten</button></form>
        <form method="POST" action="/category/toggle"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="categoryId" value="${cat.id}"><button class="btn ghost">${cat.enabled === false ? "▶️ Aktivieren" : "⏸️ Deaktivieren"}</button></form>
        <form method="POST" action="/category/delete" onsubmit="return confirm('Abteilung wirklich löschen?')"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="categoryId" value="${cat.id}"><button class="danger">🗑️ Löschen</button></form>
      </div>
    </article>`).join("")}
  </div>

  <form method="POST" action="/category" class="new">
    <input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}">
    <h3>➕ Neue Abteilung</h3>
    <div class="row"><input name="emoji" value="📦"><input name="name" placeholder="Abteilungsname" required><select name="channelId"><option value="">Channel auswählen</option>${opts(channels.filter((x) => x.type === "text"), "")}</select></div>
    <input name="description" placeholder="Beschreibung"><input name="footer" placeholder="Footer"><input name="image" placeholder="Optionales Bild (https://...)">
    <button class="btn">Erstellen</button>
  </form>
</section>

<section class="panel">
  <h2>🔥 Angebote</h2>
  ${c.offers.length ? c.offers.slice(0, 50).map((o) => `<div class="item"><span><b>${esc(o.name)}</b><small>${esc(o.price)} · ${esc(o.description)}</small></span><form method="POST" action="/offer/delete"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="offerId" value="${o.id}"><button class="danger">🗑️ Löschen</button></form></div>`).join("") : "<p class='hint'>Noch keine Angebote.</p>"}
</section>

<section class="panel">
  <h2>📝 Aktivitätslog</h2>
  ${c.logs.slice(0, 20).map((l) => `<div class="log"><b>${esc(l.action)}</b><span>${esc(l.userName)} · ${new Date(l.at).toLocaleString("de-DE")}</span></div>`).join("") || "<p class='hint'>Noch keine Aktivitäten.</p>"}
</section>
`
  );
}

app.get("/dashboard", logged, wrap(async (req, res) => {
  const guilds = req.session.guilds || [];
  const guildId = req.query.guild || guilds[0]?.id;
  const g = guilds.find((x) => x.id === guildId);

  if (!g) return res.send(page("Dashboard", "<h1>Kein verwaltbarer Server.</h1><p>Du benötigst Administrator-Rechte auf einem Discord-Server.</p>"));

  const guild = client.guilds.cache.get(guildId);
  const c = cfg(guildId);
  const channels = guild
    ? [...guild.channels.cache.values()]
        .filter((x) => [ChannelType.GuildText, ChannelType.GuildCategory].includes(x.type))
        .map((x) => ({ id: x.id, name: x.name, type: x.type === ChannelType.GuildCategory ? "category" : "text" }))
    : [];
  const roles = guild
    ? [...guild.roles.cache.values()].filter((x) => x.id !== guild.id).map((x) => ({ id: x.id, name: x.name }))
    : [];

  res.send(dashboard(g, c, channels, roles, guilds, Boolean(guild), req));
}));

app.use("/dashboard", (req, res, next) => {
  if (["POST"].includes(req.method) && !checkCsrf(req)) return res.status(403).send(page("CSRF", "<h1>❌ Anfrage abgelehnt</h1><p>Bitte Dashboard neu laden.</p>"));
  next();
});

function requireGuild(req, res) {
  const guildId = req.body.guild;
  if (!guildId || !allowed(req, guildId)) {
    res.status(403).send("Forbidden");
    return null;
  }
  return guildId;
}

app.post("/settings", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const c = cfg(guildId);

  Object.assign(c, {
    verifyRoleId: req.body.verifyRoleId || c.verifyRoleId || null,
    verifyChannelId: req.body.verifyChannelId || c.verifyChannelId || null,
    paymentChannelId: req.body.paymentChannelId || c.paymentChannelId || null,
    ticketCategoryId: req.body.ticketCategoryId || c.ticketCategoryId || null,
    ticketSupportRoleId: req.body.ticketSupportRoleId || c.ticketSupportRoleId || null,
    shopTitle: clamp(req.body.shopTitle || c.shopTitle, 256),
    shopDescription: clamp(req.body.shopDescription || c.shopDescription, 4096),
    verifyTitle: clamp(req.body.verifyTitle || c.verifyTitle, 256),
    verifyDescription: clamp(req.body.verifyDescription || c.verifyDescription, 4096),
    ticketTitle: clamp(req.body.ticketTitle || c.ticketTitle, 256),
    ticketDescription: clamp(req.body.ticketDescription || c.ticketDescription, 4096),
    brandColor: hexColor(req.body.brandColor || c.brandColor),
  });

  logAction(guildId, "Einstellungen geändert", req.session.user);
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/category", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  if (!req.body.name) return res.status(400).send("Name fehlt.");

  cfg(guildId).categories.push({
    id: id(),
    name: clamp(req.body.name, 200),
    emoji: clamp(req.body.emoji || "📦", 10),
    description: clamp(req.body.description || "", 4000),
    footer: clamp(req.body.footer || "Interesse? Eröffne ein Ticket.", 2000),
    channelId: req.body.channelId || null,
    image: safeUrl(req.body.image),
    products: [],
    enabled: true,
  });

  logAction(guildId, "Abteilung erstellt", req.session.user, { name: req.body.name });
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/category/toggle", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const cat = cfg(guildId).categories.find((x) => x.id === req.body.categoryId);
  if (cat) {
    cat.enabled = cat.enabled === false;
    logAction(guildId, cat.enabled ? "Abteilung aktiviert" : "Abteilung deaktiviert", req.session.user, { name: cat.name });
  }
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/category/delete", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const c = cfg(guildId);
  c.categories = c.categories.filter((x) => x.id !== req.body.categoryId);
  logAction(guildId, "Abteilung gelöscht", req.session.user);
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/product", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const cat = cfg(guildId).categories.find((x) => x.id === req.body.categoryId);
  if (!cat) return res.status(404).send("Abteilung nicht gefunden.");
  if (!req.body.name || !req.body.price) return res.status(400).send("Name/Preis fehlt.");

  cat.products.push({
    id: id(),
    name: clamp(req.body.name, 200),
    price: clamp(req.body.price, 50),
    description: clamp(req.body.description || "", 900),
    emoji: clamp(req.body.emoji || "✦", 10),
    enabled: true,
    inline: true,
  });

  logAction(guildId, "Produkt erstellt", req.session.user, { name: req.body.name });
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/product/delete", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const cat = cfg(guildId).categories.find((x) => x.id === req.body.categoryId);
  if (cat) cat.products = cat.products.filter((p) => p.id !== req.body.productId);
  logAction(guildId, "Produkt gelöscht", req.session.user);
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/payment", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  if (!req.body.name) return res.status(400).send("Name fehlt.");

  cfg(guildId).payments.push({
    id: id(),
    name: clamp(req.body.name, 200),
    description: clamp(req.body.description || "", 900),
    emoji: clamp(req.body.emoji || "•", 10),
  });

  logAction(guildId, "Zahlungsmethode erstellt", req.session.user, { name: req.body.name });
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/payment/delete", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const c = cfg(guildId);
  c.payments = c.payments.filter((x) => x.id !== req.body.paymentId);
  logAction(guildId, "Zahlungsmethode gelöscht", req.session.user);
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/offer/delete", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const c = cfg(guildId);
  c.offers = c.offers.filter((x) => x.id !== req.body.offerId);
  logAction(guildId, "Angebot gelöscht", req.session.user);
  res.redirect("/dashboard?guild=" + guildId);
}));

async function getTextChannel(id) {
  const ch = client.channels.cache.get(id);
  return ch?.isTextBased() ? ch : null;
}

app.post("/post-verify", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const c = cfg(guildId);
  const ch = await getTextChannel(c.verifyChannelId);
  if (!ch) return res.status(400).send("Kein gültiger Verify-Channel.");
  await ch.send(verifyMessage(c));
  logAction(guildId, "Verify-Panel gepostet", req.session.user);
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/post-category", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const c = cfg(guildId);
  const cat = c.categories.find((x) => x.id === req.body.categoryId);
  const ch = await getTextChannel(cat?.channelId);
  if (!cat || !ch) return res.status(400).send("Abteilung oder Channel fehlt.");
  await ch.send({ embeds: [categoryEmbed(cat, c)] });
  logAction(guildId, "Abteilung gepostet", req.session.user, { name: cat.name });
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/post-payments", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const c = cfg(guildId);
  const ch = await getTextChannel(c.paymentChannelId);
  if (!ch) return res.status(400).send("Kein gültiger Zahlungs-Channel.");
  await ch.send({ embeds: [paymentEmbed(c)] });
  logAction(guildId, "Zahlungen gepostet", req.session.user);
  res.redirect("/dashboard?guild=" + guildId);
}));

app.post("/post-ticket-panel", logged, wrap(async (req, res) => {
  const guildId = requireGuild(req, res);
  if (!guildId) return;
  const c = cfg(guildId);
  const ch = await getTextChannel(c.verifyChannelId);
  if (!ch) return res.status(400).send("Für das Ticket-Panel ist aktuell der Verify-Channel gesetzt. Wähle dort einen Text-Channel.");
  await ch.send(ticketMessage(c));
  logAction(guildId, "Ticket-Panel gepostet", req.session.user);
  res.redirect("/dashboard?guild=" + guildId);
}));

function page(title, body) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#080b12">
<title>${esc(title)}</title>
<style>${css()}</style>
</head>
<body><main>${body}</main></body></html>`;
}

function css() {
  return `
*{box-sizing:border-box}
body{margin:0;background:#070a10;color:#eef2ff;font-family:Inter,system-ui,-apple-system,sans-serif}
main{max-width:1350px;margin:auto;padding:28px}
header{display:flex;justify-content:space-between;align-items:center;gap:20px}
h1{font-size:32px;margin:0 0 4px}h2{margin-top:0}h3{margin:0 0 8px}
p{color:#aeb7cc;line-height:1.5}
.hero,.panel{background:linear-gradient(145deg,#151a27,#0d111a);border:1px solid #283144;border-radius:18px;padding:22px;margin:18px 0;box-shadow:0 14px 50px #0005}
.hero>span{font-size:11px;color:#91a4ff;letter-spacing:.14em}
.warning{border-color:#7d3040}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}
.stats div{background:#0b0f18;border:1px solid #252d3e;border-radius:12px;padding:14px}
.stats b{font-size:25px;display:block}.stats small{color:#9da8be}
.cats{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px}
.cats article,.new{background:#0a0e16;border:1px solid #252d3e;border-radius:15px;padding:16px}
.cathead{display:flex;justify-content:space-between;gap:10px}.cathead small{color:#9da8be}
label{display:block;font-size:13px;color:#aeb7cc;margin-top:7px}
input,select,textarea{width:100%;background:#070a10;color:#eef2ff;border:1px solid #30384a;border-radius:9px;padding:11px;margin:7px 0 10px;outline:none}
input:focus,select:focus,textarea:focus{border-color:#5865f2}
textarea{min-height:80px;resize:vertical}
button,.btn{border:0;border-radius:9px;padding:10px 13px;color:#fff;cursor:pointer;background:#5865f2;font-weight:700;text-decoration:none;display:inline-block}
.danger{background:#7d3040}.ghost{background:#20283a}
nav{display:flex;gap:8px;overflow:auto;margin:18px 0}
nav a{padding:9px 12px;border-radius:9px;background:#151a27;color:#b9c2d7;text-decoration:none;white-space:nowrap}
nav a.active{background:#5865f2;color:#fff}
.item{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#121824;border-radius:10px;padding:10px;margin:7px 0}
.item small{display:block;color:#9da8be;margin-top:4px}
.compact{margin-top:10px}.compact input{display:inline-block;width:calc(25% - 8px)}
.row{display:grid;grid-template-columns:70px 1fr 1fr;gap:8px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.hint{font-size:13px}.log{display:flex;justify-content:space-between;gap:10px;padding:10px;border-bottom:1px solid #20283a}.log span{color:#8f9ab0;font-size:12px}
@media(max-width:900px){.grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.compact input{width:100%}}
@media(max-width:560px){main{padding:14px}header{align-items:flex-start}.stats{grid-template-columns:1fr 1fr}.cats{grid-template-columns:1fr}.row{grid-template-columns:1fr}.actions form,.actions button{width:100%}}
`;
}

app.use((req, res) => res.status(404).send(page("404", "<h1>404</h1><p>Seite nicht gefunden.</p>")));

app.use((err, req, res, next) => {
  console.error("❌ Route-Fehler", req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  res.status(500).send(page("Fehler", "<h1>⚠️ Fehler</h1><p>Der Fehler wurde in den Render-Logs protokolliert.</p><p><a class='btn' href='/dashboard'>Zurück</a></p>"));
});

process.on("unhandledRejection", (err) => console.error("❌ Unhandled Rejection:", err));
process.on("uncaughtException", (err) => console.error("❌ Uncaught Exception:", err));

app.listen(PORT, () => console.log(`🌐 Dashboard läuft auf Port ${PORT}`));

if (!missingEnv.includes("DISCORD_TOKEN") && !missingEnv.includes("CLIENT_ID")) {
  client.login(process.env.DISCORD_TOKEN).catch((err) => console.error("❌ Discord Login fehlgeschlagen:", err));
} else {
  console.error("❌ Bot startet ohne Discord Login: DISCORD_TOKEN/CLIENT_ID fehlen.");
}
