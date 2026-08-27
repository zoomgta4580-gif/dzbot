require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionsBitField, ChannelType
} = require("discord.js");

const PORT = Number(process.env.PORT || 10000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");
const DEFAULT_COLOR = process.env.DEFAULT_COLOR || "#5865F2";
const BOT_NAME = process.env.BOT_NAME || "NOVA SHOP";
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}", "utf8");

let db = {};
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8") || "{}"); } catch { db = {}; }
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 100);
}
function uid(){ return crypto.randomUUID(); }
function cut(v,n){ return String(v ?? "").slice(0,n); }
function hex(v){ return /^#[0-9a-f]{6}$/i.test(String(v||"")) ? v : DEFAULT_COLOR; }
function safeUrl(v){ try { const u = new URL(String(v)); return ["http:","https:"].includes(u.protocol) ? u.toString() : ""; } catch { return ""; } }
function defaults(){
  return {
    brandColor: DEFAULT_COLOR, shopTitle:"🛒 NOVA PREMIUM SHOP",
    shopDescription:"Explore our departments, choose a product, and place an order in seconds.",
    verifyTitle:"🔐 VERIFY YOUR ACCOUNT", verifyDescription:"Complete verification to unlock the server.",
    ticketTitle:"🎫 CUSTOMER SUPPORT", ticketDescription:"Need help? Open a private support ticket with our team.",
    paymentTitle:"💳 PAYMENT METHODS", paymentDescription:"Select one of the available payment methods during checkout.",
    verifyChannelId:null, verifyRoleId:null, paymentChannelId:null, ticketPanelChannelId:null,
    ticketCategoryId:null, ticketSupportRoleId:null, orderCategoryId:null, orderChannelId:null,
    staffRoleIds:[], blacklist:[], categories:[], payments:[], offers:[], orders:[], tickets:[], logs:[]
  };
}
function cfg(gid){
  if(!db[gid]) db[gid]=defaults();
  const c=db[gid], d=defaults();
  for(const [k,v] of Object.entries(d)) if(c[k]===undefined) c[k]=Array.isArray(v)?[]:v;
  for(const cat of c.categories){ if(!Array.isArray(cat.products)) cat.products=[]; if(cat.enabled===undefined) cat.enabled=true; }
  return c;
}
function log(gid, action, user, extra={}){
  const c=cfg(gid);
  c.logs.unshift({id:uid(),action,userId:user?.id||"system",userName:user?.username||"System",at:Date.now(),...extra});
  c.logs=c.logs.slice(0,500); save();
}
function isAdmin(i){ return i.memberPermissions?.has(PermissionsBitField.Flags.Administrator); }
function isStaff(i){
  const c=cfg(i.guild.id);
  return isAdmin(i) || c.staffRoleIds.some(r=>i.member?.roles?.cache?.has(r));
}
function embed(c,title,description){
  return new EmbedBuilder().setColor(hex(c.brandColor)).setTitle(cut(title,256))
    .setDescription(cut(description,4096))
    .setFooter({text:`${BOT_NAME} • Premium Commerce System`}).setTimestamp();
}
function bigPanel(c,title,description,fields=[]){
  const e=embed(c,title,description+"\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for(const f of fields.slice(0,25)) e.addFields({name:cut(f.name,256),value:cut(f.value,1024),inline:f.inline!==false});
  return e;
}
function verifyPanel(c){
  return {embeds:[bigPanel(c,c.verifyTitle,`${c.verifyDescription}\n\n**Secure • Fast • One Click**\n\nClick the button below to receive the configured verification role.`)],
    components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("verify").setLabel("VERIFY NOW").setEmoji("✅").setStyle(ButtonStyle.Success))]};
}
function ticketPanel(c){
  return {embeds:[bigPanel(c,c.ticketTitle,`${c.ticketDescription}\n\n**PRIVATE SUPPORT • STAFF ASSISTED • FAST RESPONSE**\n\nUse the button below to create a private support channel.`)],
    components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket_open").setLabel("OPEN SUPPORT TICKET").setEmoji("🎫").setStyle(ButtonStyle.Primary))]};
}
function shopMenu(c){
  const cats=c.categories.filter(x=>x.enabled!==false).slice(0,25);
  const menu=new StringSelectMenuBuilder().setCustomId("shop_category").setPlaceholder("🛒 Select a department");
  menu.addOptions(cats.map(x=>({label:cut(x.name,100),value:x.id,description:cut(x.description||"Browse products",100),emoji:x.emoji||"📦"})));
  return {embeds:[bigPanel(c,c.shopTitle,`${c.shopDescription}\n\n**SELECT A DEPARTMENT BELOW**\n\nChoose a department to view products and start checkout.`)],
    components:[new ActionRowBuilder().addComponents(menu)]};
}
function categoryPanel(c,cat){
  const products=cat.products.filter(x=>x.enabled!==false).slice(0,25);
  const e=bigPanel(c,`${cat.emoji||"📦"} ${cat.name}`,`${cat.description||"Explore this department."}\n\n**AVAILABLE PRODUCTS**`);
  for(const p of products) e.addFields({name:`${p.emoji||"✦"} ${p.name}  •  ${p.price}`,value:`${p.description||"No description provided."}\n\n**Product ID:** \`${p.id.slice(0,8)}\``,inline:false});
  const select=new StringSelectMenuBuilder().setCustomId(`product_select:${cat.id}`).setPlaceholder("🛍️ Select a product");
  if(products.length) select.addOptions(products.map(p=>({label:cut(p.name,100),value:p.id,description:cut(`${p.price} • ${p.description||"Order now"}`,100),emoji:p.emoji||"🛍️"})));
  return {embeds:[e],components:products.length?[new ActionRowBuilder().addComponents(select)]:[]};
}
function paymentsPanel(c){
  const e=bigPanel(c,c.paymentTitle,`${c.paymentDescription}\n\n**AVAILABLE PAYMENT OPTIONS**`);
  for(const p of c.payments) e.addFields({name:`${p.emoji||"💳"} ${p.name}`,value:p.description||"Available during checkout.",inline:false});
  return {embeds:[e]};
}
function orderEmbed(c,o){
  return embed(c,`🧾 ORDER ${o.number}`,`**Thank you for your order.**\n\nYour order has been created successfully and is currently **${o.status.toUpperCase()}**.\n\nPlease keep your order number for support.\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    .addFields(
      {name:"🛍️ Product",value:o.productName,inline:true},
      {name:"💰 Price",value:o.price,inline:true},
      {name:"👤 Customer",value:`<@${o.userId}>`,inline:true},
      {name:"💳 Payment",value:o.payment||"Not selected",inline:true},
      {name:"📅 Created",value:`<t:${Math.floor(o.createdAt/1000)}:F>`,inline:true},
      {name:"📌 Status",value:o.status.toUpperCase(),inline:true}
    );
}
function orderButtons(orderId){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`order_cancel:${orderId}`).setLabel("CANCEL ORDER").setEmoji("❌").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`order_support:${orderId}`).setLabel("CONTACT SUPPORT").setEmoji("🎫").setStyle(ButtonStyle.Secondary)
  );
}
function orderNumber(){ return `NS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`; }

const commands=[
 new SlashCommandBuilder().setName("setup").setDescription("Create the basic shop configuration."),
 new SlashCommandBuilder().setName("shop").setDescription("Open the interactive shop."),
 new SlashCommandBuilder().setName("verify").setDescription("Send the verification panel."),
 new SlashCommandBuilder().setName("payments").setDescription("Send the payment panel."),
 new SlashCommandBuilder().setName("ticket-panel").setDescription("Send the support panel."),
 new SlashCommandBuilder().setName("offer").setDescription("Create a large promotional offer.")
  .addStringOption(o=>o.setName("name").setDescription("Offer name").setRequired(true))
  .addStringOption(o=>o.setName("price").setDescription("Offer price").setRequired(true))
  .addStringOption(o=>o.setName("description").setDescription("Offer description").setRequired(false)),
 new SlashCommandBuilder().setName("stats").setDescription("Show commerce statistics."),
 new SlashCommandBuilder().setName("help").setDescription("Show all commands."),
 new SlashCommandBuilder().setName("ping").setDescription("Show bot latency.")
].map(x=>x.toJSON());

const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
client.once("ready",async()=>{
  console.log(`✅ ${BOT_NAME} online as ${client.user.tag}`);
  client.user.setActivity(process.env.BOT_STATUS||"Premium Shop • /shop");
  try{
    const rest=new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID),{body:commands});
    console.log("✅ Global slash commands registered.");
  }catch(e){ console.error("❌ Command registration failed:",e); }
});
client.on("error",e=>console.error("❌ Discord error:",e));

async function openTicket(i){
  const c=cfg(i.guild.id);
  const existing=c.tickets.find(t=>t.userId===i.user.id&&!t.closedAt);
  if(existing){
    const ch=i.guild.channels.cache.get(existing.channelId);
    if(ch) return i.reply({content:`❌ You already have an open ticket: <#${ch.id}>`,ephemeral:true});
  }
  const me=i.guild.members.me;
  const overwrites=[
    {id:i.guild.roles.everyone.id,deny:[PermissionsBitField.Flags.ViewChannel]},
    {id:i.user.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory,PermissionsBitField.Flags.AttachFiles]},
    {id:me.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory,PermissionsBitField.Flags.ManageChannels]}
  ];
  for(const role of c.staffRoleIds) overwrites.push({id:role,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]});
  if(c.ticketSupportRoleId) overwrites.push({id:c.ticketSupportRoleId,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages,PermissionsBitField.Flags.ReadMessageHistory]});
  const ch=await i.guild.channels.create({name:`ticket-${i.user.username.replace(/[^a-z0-9]/gi,"-").slice(0,15)}-${Date.now().toString().slice(-4)}`,
    type:ChannelType.GuildText,parent:c.ticketCategoryId||undefined,permissionOverwrites:overwrites,topic:`Customer support ticket for ${i.user.tag}`});
  const close=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket_close").setLabel("CLOSE TICKET").setEmoji("🔒").setStyle(ButtonStyle.Danger));
  await ch.send({content:`<@${i.user.id}>${c.ticketSupportRoleId?` <@&${c.ticketSupportRoleId}>`:""}`,
    embeds:[bigPanel(c,"🎫 SUPPORT TICKET CREATED","**Welcome to premium customer support.**\n\nPlease provide your order number, explain the issue clearly, and attach screenshots when useful.\n\n**A staff member will assist you as soon as possible.**")],components:[close]});
  c.tickets.push({id:uid(),channelId:ch.id,userId:i.user.id,userName:i.user.tag,createdAt:Date.now()});
  log(i.guild.id,"Ticket opened",i.user,{channelId:ch.id});
  return i.reply({content:`✅ Your private support ticket has been created: <#${ch.id}>`,ephemeral:true});
}
async function closeTicket(i){
  const c=cfg(i.guild.id), t=c.tickets.find(x=>x.channelId===i.channelId&&!x.closedAt);
  if(!t)return i.reply({content:"❌ This channel is not an active support ticket.",ephemeral:true});
  const ok=t.userId===i.user.id||isStaff(i)||(c.ticketSupportRoleId&&i.member.roles.cache.has(c.ticketSupportRoleId));
  if(!ok)return i.reply({content:"❌ You do not have permission to close this ticket.",ephemeral:true});
  t.closedAt=Date.now(); log(i.guild.id,"Ticket closed",i.user,{channelId:i.channelId});
  await i.reply("🔒 This ticket will be closed in **5 seconds**.");
  setTimeout(()=>i.channel.delete("Support ticket closed").catch(()=>{}),5000);
}
function productBy(c,id){ for(const cat of c.categories){const p=cat.products.find(x=>x.id===id);if(p)return {cat,p};} return null; }
function isBlacklisted(c,userId){ return c.blacklist.some(x=>x.userId===userId); }

client.on("interactionCreate",async i=>{
  try{
    if(!i.guild)return;
    const c=cfg(i.guild.id);

    if(i.isButton()){
      if(i.customId==="verify"){
        if(!c.verifyRoleId)return i.reply({content:"❌ Verification is not configured yet. Please contact staff.",ephemeral:true});
        if(isBlacklisted(c,i.user.id))return i.reply({content:"❌ You are currently restricted from using this server's commerce system.",ephemeral:true});
        const m=await i.guild.members.fetch(i.user.id), r=i.guild.roles.cache.get(c.verifyRoleId);
        if(!r)return i.reply({content:"❌ The configured verification role no longer exists.",ephemeral:true});
        if(r.position>=i.guild.members.me.roles.highest.position)return i.reply({content:"❌ The verification role must be below the bot's highest role.",ephemeral:true});
        if(m.roles.cache.has(r.id))return i.reply({content:"✅ You are already verified.",ephemeral:true});
        await m.roles.add(r); log(i.guild.id,"Member verified",i.user); return i.reply({content:"✅ Verification complete. Welcome!",ephemeral:true});
      }
      if(i.customId==="ticket_open")return openTicket(i);
      if(i.customId==="ticket_close")return closeTicket(i);
      if(i.customId.startsWith("order_cancel:")){
        const id=i.customId.split(":")[1], o=c.orders.find(x=>x.id===id);
        if(!o||o.userId!==i.user.id)return i.reply({content:"❌ You cannot cancel this order.",ephemeral:true});
        if(["completed","cancelled"].includes(o.status))return i.reply({content:"❌ This order can no longer be cancelled.",ephemeral:true});
        o.status="cancelled"; log(i.guild.id,"Order cancelled",i.user,{orderId:o.number});
        return i.update({embeds:[orderEmbed(c,o)],components:[]});
      }
      if(i.customId.startsWith("order_support:"))return openTicket(i);
    }

    if(i.isStringSelectMenu()){
      if(i.customId==="shop_category"){
        const cat=c.categories.find(x=>x.id===i.values[0]&&x.enabled!==false);
        if(!cat)return i.reply({content:"❌ This department is no longer available.",ephemeral:true});
        return i.update(categoryPanel(c,cat));
      }
      if(i.customId.startsWith("product_select:")){
        const p=productBy(c,i.values[0]); if(!p)return i.reply({content:"❌ This product is no longer available.",ephemeral:true});
        if(isBlacklisted(c,i.user.id))return i.reply({content:"❌ You are restricted from placing orders.",ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`checkout:${p.p.id}`).setTitle(cut(`Order • ${p.p.name}`,45));
        const pay=new TextInputBuilder().setCustomId("payment").setLabel("Payment method").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("PayPal / Bank Transfer / etc.");
        const note=new TextInputBuilder().setCustomId("note").setLabel("Order note (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder("Additional information for staff");
        modal.addComponents(new ActionRowBuilder().addComponents(pay),new ActionRowBuilder().addComponents(note));
        return i.showModal(modal);
      }
    }

    if(i.isModalSubmit()&&i.customId.startsWith("checkout:")){
      const found=productBy(c,i.customId.split(":")[1]);
      if(!found)return i.reply({content:"❌ This product is no longer available.",ephemeral:true});
      const o={id:uid(),number:orderNumber(),userId:i.user.id,userName:i.user.tag,productId:found.p.id,productName:found.p.name,price:found.p.price,payment:cut(i.fields.getTextInputValue("payment"),200),note:cut(i.fields.getTextInputValue("note"),1000),status:"pending",createdAt:Date.now()};
      c.orders.unshift(o); save(); log(i.guild.id,"Order created",i.user,{orderId:o.number,product:o.productName});
      const ch=c.orderChannelId?client.channels.cache.get(c.orderChannelId):null;
      if(ch?.isTextBased())await ch.send({embeds:[orderEmbed(c,o)],components:[orderButtons(o.id)]});
      return i.reply({embeds:[orderEmbed(c,o)],ephemeral:true});
    }

    if(!i.isChatInputCommand())return;
    if(["setup","verify","payments","ticket-panel","offer"].includes(i.commandName)&&!isAdmin(i))
      return i.reply({content:"❌ Administrator permission is required for this command.",ephemeral:true});

    if(i.commandName==="ping")return i.reply(`🏓 **PONG** • WebSocket latency: **${client.ws.ping}ms**`);
    if(i.commandName==="help")return i.reply({embeds:[bigPanel(c,"📚 NOVA SHOP HELP","**Premium commerce commands**\n\n`/shop` — Open the interactive shop\n`/verify` — Send verification panel\n`/payments` — Send payment panel\n`/ticket-panel` — Send support panel\n`/offer` — Create a promotional offer\n`/stats` — Show statistics\n`/setup` — Create starter configuration\n`/ping` — Check latency")],ephemeral:true});
    if(i.commandName==="stats"){
      const products=c.categories.reduce((n,x)=>n+x.products.length,0);
      const open=c.tickets.filter(x=>!x.closedAt).length, pending=c.orders.filter(x=>x.status==="pending").length;
      return i.reply({embeds:[bigPanel(c,"📊 COMMERCE STATISTICS","**Live server commerce overview**",[
        {name:"📁 Departments",value:String(c.categories.length)},{name:"🛍️ Products",value:String(products)},
        {name:"🧾 Total Orders",value:String(c.orders.length)},{name:"⏳ Pending Orders",value:String(pending)},
        {name:"🎫 Open Tickets",value:String(open)},{name:"🚫 Blacklisted",value:String(c.blacklist.length)}
      ])],ephemeral:true});
    }
    if(i.commandName==="setup"){
      const guild=i.guild, me=guild.members.me;
      const text=guild.channels.cache.find(x=>x.type===ChannelType.GuildText&&!x.isThread());
      if(text&&!c.shopTitle)c.shopTitle="🛒 NOVA PREMIUM SHOP";
      if(!c.categories.length)c.categories.push({id:uid(),name:"General",emoji:"📦",description:"Our general products.",channelId:text?.id||null,enabled:true,products:[]});
      if(!c.verifyChannelId)c.verifyChannelId=text?.id||null;
      if(!c.paymentChannelId)c.paymentChannelId=text?.id||null;
      if(!c.ticketPanelChannelId)c.ticketPanelChannelId=text?.id||null;
      if(!c.orderChannelId)c.orderChannelId=text?.id||null;
      save(); log(i.guild.id,"Starter setup created",i.user);
      return i.reply({embeds:[bigPanel(c,"✅ SETUP COMPLETE","**Starter commerce configuration created.**\n\nOpen the web dashboard to select the exact channels, roles, departments, products, payments, staff roles, blacklist entries, and order settings.")],ephemeral:true});
    }
    if(i.commandName==="shop"){
      if(!c.categories.filter(x=>x.enabled!==false).length)return i.reply({content:"❌ No shop departments are configured yet.",ephemeral:true});
      return i.reply(shopMenu(c));
    }
    if(i.commandName==="verify"){
      const ch=client.channels.cache.get(c.verifyChannelId)||i.channel; if(!ch?.isTextBased())return i.reply({content:"❌ Verification channel is not configured.",ephemeral:true});
      await ch.send(verifyPanel(c)); log(i.guild.id,"Verification panel sent",i.user,{channelId:ch.id}); return i.reply({content:`✅ Verification panel sent to <#${ch.id}>.`,ephemeral:true});
    }
    if(i.commandName==="payments"){
      const ch=client.channels.cache.get(c.paymentChannelId)||i.channel; if(!ch?.isTextBased())return i.reply({content:"❌ Payment channel is not configured.",ephemeral:true});
      await ch.send(paymentsPanel(c)); log(i.guild.id,"Payment panel sent",i.user,{channelId:ch.id}); return i.reply({content:`✅ Payment panel sent to <#${ch.id}>.`,ephemeral:true});
    }
    if(i.commandName==="ticket-panel"){
      const ch=client.channels.cache.get(c.ticketPanelChannelId)||i.channel; if(!ch?.isTextBased())return i.reply({content:"❌ Ticket panel channel is not configured.",ephemeral:true});
      await ch.send(ticketPanel(c)); log(i.guild.id,"Ticket panel sent",i.user,{channelId:ch.id}); return i.reply({content:`✅ Ticket panel sent to <#${ch.id}>.`,ephemeral:true});
    }
    if(i.commandName==="offer"){
      const name=i.options.getString("name"), price=i.options.getString("price"), desc=i.options.getString("description")||"Limited-time promotion.";
      const ch=client.channels.cache.get(c.orderChannelId)||i.channel;
      await ch.send({embeds:[bigPanel(c,`🔥 ${name}`,`**LIMITED-TIME OFFER**\n\n${desc}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,[{name:"💰 SPECIAL PRICE",value:price,inline:true},{name:"⏳ AVAILABILITY",value:"Contact support to order.",inline:true}])]});
      c.offers.unshift({id:uid(),name,price,description:desc,createdAt:Date.now()}); log(i.guild.id,"Offer created",i.user,{name}); return i.reply({content:"✅ Promotional offer published.",ephemeral:true});
    }
  }catch(e){
    console.error("❌ Interaction error:",e);
    if(!i.replied&&!i.deferred) i.reply({content:"❌ An unexpected error occurred. Please check the server logs.",ephemeral:true}).catch(()=>{});
  }
});

// ---------------- WEB DASHBOARD ----------------
const app=express();
app.set("trust proxy",1); app.disable("x-powered-by");
app.use(express.urlencoded({extended:true,limit:"100kb"})); app.use(express.json({limit:"100kb"}));
app.use(session({secret:process.env.SESSION_SECRET||"change-me",resave:false,saveUninitialized:false,cookie:{maxAge:86400000,httpOnly:true,sameSite:"lax",secure:process.env.COOKIE_SECURE!=="false"}}));
app.use((req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","DENY");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");next();});
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function csrf(req){return req.session.csrf||(req.session.csrf=crypto.randomBytes(24).toString("hex"));}
function auth(req,res,next){if(req.session.user)return next();res.redirect("/login");}
function allowed(req,gid){return Boolean(req.session.guilds?.some(g=>g.id===gid));}
function postOK(req,res){if(req.body._csrf!==req.session.csrf){res.status(403).send(page("Security","<div class='card'><h1>Request blocked</h1><p>Reload the dashboard and try again.</p></div>"));return false;}if(!req.body.guild||!allowed(req,req.body.guild)){res.status(403).send("Forbidden");return false;}return true;}
function redirectDash(res,gid,tab="overview"){res.redirect(`/dashboard?guild=${encodeURIComponent(gid)}&tab=${encodeURIComponent(tab)}`);}
function selectOptions(items,selected,label="Select"){
  return `<option value="">${esc(label)}</option>`+items.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?"selected":""}>${esc(x.name)}</option>`).join("");
}
function nav(gid,tab){return ["overview","shop","orders","tickets","security","settings","logs"].map(x=>`<a class="${tab===x?"active":""}" href="/dashboard?guild=${encodeURIComponent(gid)}&tab=${x}">${x.toUpperCase()}</a>`).join("");}
function dashboardHTML(g,c,guilds,channels,roles,req){
  const token=csrf(req), tab=req.query.tab||"overview";
  const products=c.categories.reduce((n,x)=>n+x.products.length,0);
  const pending=c.orders.filter(x=>x.status==="pending").length, open=c.tickets.filter(x=>!x.closedAt).length;
  const base=`<header><div><div class="eyebrow">● LIVE COMMERCE CONTROL</div><h1>${esc(BOT_NAME)}</h1><p>${esc(g.name)} · Premium Admin Dashboard</p></div><a class="btn ghost" href="/logout">LOG OUT</a></header><nav>${nav(g.id,tab)}</nav>`;
  let content="";
  if(tab==="overview") content=`<div class="hero"><div class="eyebrow">PREMIUM SHOP MANAGEMENT</div><h2>Everything in one place.</h2><p>Manage your shop, orders, customers, staff access, tickets and Discord panels from one modern control center.</p><div class="stats"><div><b>${c.categories.length}</b><small>Departments</small></div><div><b>${products}</b><small>Products</small></div><div><b>${c.orders.length}</b><small>Total Orders</small></div><div><b>${pending}</b><small>Pending Orders</small></div><div><b>${open}</b><small>Open Tickets</small></div><div><b>${c.blacklist.length}</b><small>Blacklisted</small></div></div></div>
  <div class="grid"><div class="card"><h2>⚡ Quick Actions</h2><form method="post" action="/send"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="type" value="shop"><button class="btn">🛒 Send Shop</button></form><form method="post" action="/send"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="type" value="verify"><button class="btn">🔐 Send Verify</button></form><form method="post" action="/send"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="type" value="ticket"><button class="btn">🎫 Send Ticket Panel</button></form><form method="post" action="/send"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="type" value="payments"><button class="btn">💳 Send Payments</button></form></div>
  <div class="card"><h2>🟢 System Status</h2><p>Discord: <b>${client.isReady()?"ONLINE":"OFFLINE"}</b></p><p>Bot guilds: <b>${client.guilds.cache.size}</b></p><p>Orders stored: <b>${c.orders.length}</b></p><p>Persistent storage: <b>${esc(DATA_DIR)}</b></p><a class="btn ghost" href="/health">Health Check</a></div></div>`;
  if(tab==="shop") content=`<div class="card"><h2>🛒 Interactive Shop</h2><p>Create departments, products, images and pricing. Customers use dropdown menus directly in Discord.</p>${c.categories.map(cat=>`<div class="cat"><div class="cathead"><h3>${esc(cat.emoji)} ${esc(cat.name)}</h3><span>${cat.enabled===false?"DISABLED":"ACTIVE"}</span></div><p>${esc(cat.description)}</p><p class="muted">${cat.products.length} products · ${cat.channelId?`<b>#${esc(channels.find(x=>x.id===cat.channelId)?.name||"unknown")}</b>`:"No channel"}</p>${cat.products.map(p=>`<div class="item"><span><b>${esc(p.emoji)} ${esc(p.name)}</b><small>${esc(p.price)} · ${esc(p.description)}</small></span><form method="post" action="/product/delete"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="categoryId" value="${cat.id}"><input type="hidden" name="productId" value="${p.id}"><button class="danger">DELETE</button></form></div>`).join("")}<form method="post" action="/product"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="categoryId" value="${cat.id}"><div class="row"><input name="name" placeholder="Product name" required><input name="price" placeholder="Price" required><input name="emoji" value="✦"><input name="description" placeholder="Description"></div><button class="btn">+ ADD PRODUCT</button></form><div class="actions"><form method="post" action="/send-category"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="categoryId" value="${cat.id}"><button class="btn">📤 SEND DEPARTMENT</button></form><form method="post" action="/category/toggle"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="categoryId" value="${cat.id}"><button class="btn ghost">${cat.enabled===false?"ENABLE":"DISABLE"}</button></form><form method="post" action="/category/delete"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="categoryId" value="${cat.id}"><button class="danger">DELETE DEPARTMENT</button></form></div></div>`).join("")}
  <form method="post" action="/category" class="new"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><h3>➕ CREATE DEPARTMENT</h3><div class="row"><input name="emoji" value="📦"><input name="name" placeholder="Department name" required><select name="channelId">${selectOptions(channels,"","Select Discord channel")}</select><input name="image" placeholder="Image URL"></div><textarea name="description" placeholder="Department description"></textarea><button class="btn">CREATE DEPARTMENT</button></form></div>`;
  if(tab==="orders") content=`<div class="card"><h2>🧾 Order Management</h2><p>Automatic order confirmations are sent to the configured order channel. Update status below.</p>${c.orders.slice(0,100).map(o=>`<div class="order"><div><h3>${esc(o.number)} · ${esc(o.productName)}</h3><p>${esc(o.price)} · <@${esc(o.userId)}> · ${esc(o.payment)}</p><small>${new Date(o.createdAt).toLocaleString("en-US")} · Current status: <b>${esc(o.status)}</b></small></div><form method="post" action="/order/status"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="orderId" value="${o.id}"><select name="status">${["pending","paid","processing","completed","cancelled"].map(s=>`<option ${o.status===s?"selected":""}>${s}</option>`).join("")}</select><button class="btn">UPDATE</button></form></div>`).join("")||"<p class='muted'>No orders yet.</p>"}</div>`;
  if(tab==="tickets") content=`<div class="card"><h2>🎫 Ticket Center</h2><p>Private customer support tickets created by your Discord users.</p>${c.tickets.slice(0,100).map(t=>`<div class="item"><span><b>${esc(t.userName)}</b><small>Channel: ${esc(t.channelId)} · Created ${new Date(t.createdAt).toLocaleString("en-US")} · ${t.closedAt?"Closed":"OPEN"}</small></span>${!t.closedAt?`<a class="btn" href="https://discord.com/channels/${g.id}/${t.channelId}" target="_blank">OPEN TICKET</a>`:""}</div>`).join("")||"<p class='muted'>No tickets yet.</p>"}</div>`;
  if(tab==="security") content=`<div class="grid"><div class="card"><h2>🛡️ Staff Permissions</h2><p>Staff roles can manage support tickets and commerce actions.</p>${c.staffRoleIds.map(r=>`<div class="item"><b>@${esc(roles.find(x=>x.id===r)?.name||r)}</b><form method="post" action="/staff/remove"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="roleId" value="${r}"><button class="danger">REMOVE</button></form></div>`).join("")}<form method="post" action="/staff/add"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><select name="roleId">${selectOptions(roles,"","Select staff role")}</select><button class="btn">+ ADD STAFF ROLE</button></form></div>
  <div class="card"><h2>🚫 Blacklist</h2><p>Blocked users cannot verify or place orders.</p>${c.blacklist.map(x=>`<div class="item"><span><b>${esc(x.userName||x.userId)}</b><small>${esc(x.reason||"No reason")}</small></span><form method="post" action="/blacklist/remove"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><input type="hidden" name="userId" value="${x.userId}"><button class="danger">REMOVE</button></form></div>`).join("")}<form method="post" action="/blacklist/add"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><div class="row"><input name="userId" placeholder="Discord User ID" required><input name="userName" placeholder="Username"><input name="reason" placeholder="Reason"></div><button class="btn danger">+ BLACKLIST USER</button></form></div></div>`;
  if(tab==="settings") content=`<div class="card"><h2>⚙️ Server Configuration</h2><form method="post" action="/settings"><input type="hidden" name="_csrf" value="${token}"><input type="hidden" name="guild" value="${g.id}"><div class="grid2"><label>Shop title<input name="shopTitle" value="${esc(c.shopTitle)}"></label><label>Brand color<input name="brandColor" value="${esc(c.brandColor)}"></label><label>Shop description<textarea name="shopDescription">${esc(c.shopDescription)}</textarea></label><label>Verify title<input name="verifyTitle" value="${esc(c.verifyTitle)}"></label><label>Verify description<textarea name="verifyDescription">${esc(c.verifyDescription)}</textarea></label><label>Ticket title<input name="ticketTitle" value="${esc(c.ticketTitle)}"></label><label>Ticket description<textarea name="ticketDescription">${esc(c.ticketDescription)}</textarea></label><label>Payment title<input name="paymentTitle" value="${esc(c.paymentTitle)}"></label><label>Payment description<textarea name="paymentDescription">${esc(c.paymentDescription)}</textarea></label></div><h3>Discord Channels & Roles</h3><div class="grid2"><label>Verify channel<select name="verifyChannelId">${selectOptions(channels,"", "Select channel")}</select></label><label>Verify role<select name="verifyRoleId">${selectOptions(roles,"","Select role")}</select></label><label>Payment channel<select name="paymentChannelId">${selectOptions(channels,"","Select channel")}</select></label><label>Ticket panel channel<select name="ticketPanelChannelId">${selectOptions(channels,"","Select channel")}</select></label><label>Ticket category<select name="ticketCategoryId">${selectOptions(channels.filter(x=>x.type==="category"),"","Select category")}</select></label><label>Ticket support role<select name="ticketSupportRoleId">${selectOptions(roles,"","Select role")}</select></label><label>Order channel<select name="orderChannelId">${selectOptions(channels,"","Select channel")}</select></label></div><button class="btn">SAVE ALL SETTINGS</button></form></div>`;
  if(tab==="logs") content=`<div class="card"><h2>📝 Activity Logs</h2>${c.logs.slice(0,150).map(l=>`<div class="log"><b>${esc(l.action)}</b><span>${esc(l.userName)} · ${new Date(l.at).toLocaleString("en-US")}</span></div>`).join("")||"<p class='muted'>No activity yet.</p>"}</div>`;
  return base+content;
}
function page(title,body){
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css()}</style></head><body><main>${body}</main></body></html>`;
}
function css(){return `
*{box-sizing:border-box}body{margin:0;background:#06080d;color:#f4f7ff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:16px}main{max-width:1500px;margin:auto;padding:34px}header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}h1{font-size:42px;line-height:1;margin:0 0 8px;letter-spacing:-1.5px}h2{font-size:27px;margin:0 0 14px}h3{font-size:19px;margin:0 0 8px}p{color:#aab4c9;line-height:1.65}.eyebrow{font-size:11px;font-weight:900;letter-spacing:.18em;color:#8799ff;margin-bottom:10px}.hero,.card{background:linear-gradient(145deg,#141925,#0c1018);border:1px solid #273044;border-radius:22px;padding:28px;margin-bottom:20px;box-shadow:0 22px 70px #0007}.hero h2{font-size:38px}.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-top:24px}.stats div{background:#080c13;border:1px solid #222b3d;border-radius:15px;padding:18px}.stats b{display:block;font-size:30px}.stats small,.muted{color:#8e9ab0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}nav{display:flex;gap:8px;overflow:auto;margin-bottom:22px;padding-bottom:4px}nav a{padding:12px 16px;border-radius:12px;background:#111724;color:#aab4c9;text-decoration:none;font-weight:800;white-space:nowrap}nav a.active{background:#5865f2;color:white}label{display:block;color:#aab4c9;font-weight:700;font-size:13px}input,select,textarea{width:100%;background:#080c13;color:#f4f7ff;border:1px solid #303a50;border-radius:12px;padding:13px;margin:8px 0 14px;font:inherit}textarea{min-height:110px;resize:vertical}.btn,.danger{border:0;border-radius:11px;padding:12px 16px;color:#fff;background:#5865f2;font-weight:900;cursor:pointer;text-decoration:none;display:inline-block;margin:4px 4px 4px 0}.ghost{background:#20283a}.danger{background:#7e3042}.row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.cat,.order{border:1px solid #273044;background:#0a0e15;border-radius:16px;padding:20px;margin:14px 0}.cathead{display:flex;justify-content:space-between}.item{display:flex;justify-content:space-between;align-items:center;gap:14px;background:#111722;border:1px solid #202a3c;border-radius:12px;padding:13px;margin:8px 0}.item small{display:block;color:#8f9bb0;margin-top:4px}.actions{display:flex;gap:6px;flex-wrap:wrap}.new{border:1px dashed #3a4760;padding:20px;border-radius:16px;margin-top:18px}.log{display:flex;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid #20283a}.log span{color:#8e9ab0;font-size:13px}.auth{max-width:700px;margin:10vh auto;text-align:center}.auth .hero{padding:50px}.auth h1{font-size:54px}@media(max-width:1050px){.stats{grid-template-columns:repeat(3,1fr)}}@media(max-width:800px){main{padding:18px}.grid,.grid2{grid-template-columns:1fr}.row{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}h1{font-size:34px}.hero h2{font-size:29px}}@media(max-width:500px){.stats{grid-template-columns:1fr 1fr}.item,.log{align-items:flex-start;flex-direction:column}header{align-items:flex-start;flex-direction:column}}
`;}

// OAuth
app.get("/health",(req,res)=>res.json({ok:true,discordReady:client.isReady(),uptime:Math.round(process.uptime()),time:new Date().toISOString()}));
app.get("/",(req,res)=>res.redirect(req.session.user?"/dashboard":"/login"));
app.get("/login",(req,res)=>{
  if(!process.env.CLIENT_ID||!process.env.CLIENT_SECRET||!process.env.REDIRECT_URI)return res.status(500).send(page("Configuration Missing","<div class='auth'><div class='hero'><h1>⚠️ Configuration Missing</h1><p>Set CLIENT_ID, CLIENT_SECRET and REDIRECT_URI in Render.</p></div></div>"));
  req.session.oauthState=crypto.randomBytes(24).toString("hex");
  const q=new URLSearchParams({client_id:process.env.CLIENT_ID,redirect_uri:process.env.REDIRECT_URI,response_type:"code",scope:"identify guilds",state:req.session.oauthState});
  res.redirect("https://discord.com/oauth2/authorize?"+q);
});
app.get("/callback",async(req,res)=>{
  try{
    if(!req.query.code||req.query.state!==req.session.oauthState)return res.status(400).send(page("OAuth Error","<div class='auth'><div class='hero'><h1>❌ OAuth Error</h1><p>Please log in again.</p></div></div>"));
    const body=new URLSearchParams({client_id:process.env.CLIENT_ID,client_secret:process.env.CLIENT_SECRET,grant_type:"authorization_code",code:req.query.code,redirect_uri:process.env.REDIRECT_URI});
    const tr=await fetch("https://discord.com/api/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    const token=await tr.json(); if(!token.access_token)return res.status(400).send(page("OAuth Error","<div class='auth'><div class='hero'><h1>❌ Login Failed</h1><p>Discord OAuth did not return an access token.</p></div></div>"));
    const h={Authorization:`Bearer ${token.access_token}`};
    const [ur,gr]=await Promise.all([fetch("https://discord.com/api/users/@me",{headers:h}),fetch("https://discord.com/api/users/@me/guilds",{headers:h})]);
    req.session.user=await ur.json(); const gs=await gr.json();
    req.session.guilds=Array.isArray(gs)?gs.filter(g=>(Number(g.permissions)&8)===8):[];
    req.session.csrf=crypto.randomBytes(24).toString("hex"); delete req.session.oauthState; res.redirect("/dashboard");
  }catch(e){console.error(e);res.status(500).send(page("OAuth Error","<div class='auth'><div class='hero'><h1>❌ OAuth Error</h1><p>Check Render logs.</p></div></div>"));}
});
app.get("/logout",(req,res)=>req.session.destroy(()=>res.redirect("/login")));
app.get("/dashboard",auth,(req,res)=>{
  const gs=req.session.guilds||[], gid=req.query.guild||gs[0]?.id, g=gs.find(x=>x.id===gid);
  if(!g)return res.send(page("Dashboard","<div class='auth'><div class='hero'><h1>No Manageable Server</h1><p>You need Administrator permissions on a Discord server.</p></div></div>"));
  const dg=client.guilds.cache.get(gid), channels=dg?[...dg.channels.cache.values()].filter(x=>[ChannelType.GuildText,ChannelType.GuildCategory].includes(x.type)).map(x=>({id:x.id,name:x.name,type:x.type===ChannelType.GuildCategory?"category":"text"})):[];
  const roles=dg?[...dg.roles.cache.values()].filter(x=>x.id!==dg.id).map(x=>({id:x.id,name:x.name})):[];
  res.send(page("Dashboard",dashboardHTML(g,cfg(gid),gs,channels,roles,req)));
});
app.post("/settings",auth,(req,res)=>{if(!postOK(req,res))return;const c=cfg(req.body.guild);Object.assign(c,{shopTitle:cut(req.body.shopTitle||c.shopTitle,256),shopDescription:cut(req.body.shopDescription||c.shopDescription,4000),brandColor:hex(req.body.brandColor),verifyTitle:cut(req.body.verifyTitle||c.verifyTitle,256),verifyDescription:cut(req.body.verifyDescription||c.verifyDescription,4000),ticketTitle:cut(req.body.ticketTitle||c.ticketTitle,256),ticketDescription:cut(req.body.ticketDescription||c.ticketDescription,4000),paymentTitle:cut(req.body.paymentTitle||c.paymentTitle,256),paymentDescription:cut(req.body.paymentDescription||c.paymentDescription,4000),verifyChannelId:req.body.verifyChannelId||null,verifyRoleId:req.body.verifyRoleId||null,paymentChannelId:req.body.paymentChannelId||null,ticketPanelChannelId:req.body.ticketPanelChannelId||null,ticketCategoryId:req.body.ticketCategoryId||null,ticketSupportRoleId:req.body.ticketSupportRoleId||null,orderChannelId:req.body.orderChannelId||null});save();log(req.body.guild,"Dashboard settings updated",req.session.user);redirectDash(res,req.body.guild,"settings");});
app.post("/category",auth,(req,res)=>{if(!postOK(req,res))return;cfg(req.body.guild).categories.push({id:uid(),name:cut(req.body.name,200),emoji:cut(req.body.emoji||"📦",10),description:cut(req.body.description||"",2000),channelId:req.body.channelId||null,image:safeUrl(req.body.image),enabled:true,products:[]});save();log(req.body.guild,"Department created",req.session.user);redirectDash(res,req.body.guild,"shop");});
app.post("/category/toggle",auth,(req,res)=>{if(!postOK(req,res))return;const x=cfg(req.body.guild).categories.find(x=>x.id===req.body.categoryId);if(x)x.enabled=x.enabled===false;save();redirectDash(res,req.body.guild,"shop");});
app.post("/category/delete",auth,(req,res)=>{if(!postOK(req,res))return;const c=cfg(req.body.guild);c.categories=c.categories.filter(x=>x.id!==req.body.categoryId);save();log(req.body.guild,"Department deleted",req.session.user);redirectDash(res,req.body.guild,"shop");});
app.post("/product",auth,(req,res)=>{if(!postOK(req,res))return;const cat=cfg(req.body.guild).categories.find(x=>x.id===req.body.categoryId);if(!cat)return res.status(404).send("Department not found");cat.products.push({id:uid(),name:cut(req.body.name,200),price:cut(req.body.price,80),emoji:cut(req.body.emoji||"✦",10),description:cut(req.body.description||"",800),enabled:true});save();log(req.body.guild,"Product created",req.session.user);redirectDash(res,req.body.guild,"shop");});
app.post("/product/delete",auth,(req,res)=>{if(!postOK(req,res))return;const cat=cfg(req.body.guild).categories.find(x=>x.id===req.body.categoryId);if(cat)cat.products=cat.products.filter(p=>p.id!==req.body.productId);save();redirectDash(res,req.body.guild,"shop");});
app.post("/staff/add",auth,(req,res)=>{if(!postOK(req,res))return;const c=cfg(req.body.guild);if(req.body.roleId&&!c.staffRoleIds.includes(req.body.roleId))c.staffRoleIds.push(req.body.roleId);save();redirectDash(res,req.body.guild,"security");});
app.post("/staff/remove",auth,(req,res)=>{if(!postOK(req,res))return;const c=cfg(req.body.guild);c.staffRoleIds=c.staffRoleIds.filter(x=>x!==req.body.roleId);save();redirectDash(res,req.body.guild,"security");});
app.post("/blacklist/add",auth,(req,res)=>{if(!postOK(req,res))return;const c=cfg(req.body.guild);if(req.body.userId&&!c.blacklist.some(x=>x.userId===req.body.userId))c.blacklist.push({userId:cut(req.body.userId,30),userName:cut(req.body.userName||"",100),reason:cut(req.body.reason||"No reason provided",500),createdAt:Date.now()});save();log(req.body.guild,"User blacklisted",req.session.user,{userId:req.body.userId});redirectDash(res,req.body.guild,"security");});
app.post("/blacklist/remove",auth,(req,res)=>{if(!postOK(req,res))return;const c=cfg(req.body.guild);c.blacklist=c.blacklist.filter(x=>x.userId!==req.body.userId);save();log(req.body.guild,"User removed from blacklist",req.session.user,{userId:req.body.userId});redirectDash(res,req.body.guild,"security");});
app.post("/order/status",auth,(req,res)=>{if(!postOK(req,res))return;const c=cfg(req.body.guild),o=c.orders.find(x=>x.id===req.body.orderId);if(!o)return res.status(404).send("Order not found");const allowed=["pending","paid","processing","completed","cancelled"];if(allowed.includes(req.body.status))o.status=req.body.status;save();log(req.body.guild,"Order status updated",req.session.user,{orderId:o.number,status:o.status});redirectDash(res,req.body.guild,"orders");});
app.post("/send",auth,async(req,res)=>{if(!postOK(req,res))return;const c=cfg(req.body.guild),type=req.body.type;let chId,payload;
  if(type==="shop"){chId=c.categories.find(x=>x.enabled!==false&&x.channelId)?.channelId;payload=shopMenu(c);}
  if(type==="verify"){chId=c.verifyChannelId;payload=verifyPanel(c);}
  if(type==="ticket"){chId=c.ticketPanelChannelId;payload=ticketPanel(c);}
  if(type==="payments"){chId=c.paymentChannelId;payload=paymentsPanel(c);}
  const ch=client.channels.cache.get(chId);if(!ch?.isTextBased())return res.status(400).send(page("Send Error","<div class='auth'><div class='hero'><h1>❌ Channel Not Configured</h1><p>Select a valid channel in Settings.</p></div></div>"));
  await ch.send(payload);log(req.body.guild,`${type} panel sent`,req.session.user);redirectDash(res,req.body.guild,"overview");
});
app.post("/send-category",auth,async(req,res)=>{if(!postOK(req,res))return;const c=cfg(req.body.guild),cat=c.categories.find(x=>x.id===req.body.categoryId),ch=client.channels.cache.get(cat?.channelId);if(!cat||!ch?.isTextBased())return res.status(400).send("Department channel not configured.");await ch.send(categoryPanel(c,cat));log(req.body.guild,"Department panel sent",req.session.user);redirectDash(res,req.body.guild,"shop");});
app.use((req,res)=>res.status(404).send(page("404","<div class='auth'><div class='hero'><h1>404</h1><p>Page not found.</p></div></div>")));
app.use((err,req,res,next)=>{console.error("❌ Web error:",err);if(!res.headersSent)res.status(500).send(page("Error","<div class='auth'><div class='hero'><h1>⚠️ Server Error</h1><p>Check the Render logs.</p></div></div>"));});

app.listen(PORT,()=>console.log(`🌐 Dashboard listening on ${PORT}`));
process.on("unhandledRejection",e=>console.error("Unhandled rejection:",e));
process.on("uncaughtException",e=>console.error("Uncaught exception:",e));
if(process.env.DISCORD_TOKEN&&process.env.CLIENT_ID)client.login(process.env.DISCORD_TOKEN).catch(e=>console.error("❌ Discord login failed:",e));
else console.error("❌ DISCORD_TOKEN or CLIENT_ID is missing.");
