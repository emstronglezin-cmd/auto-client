import express from 'express';
import crypto from 'node:crypto';
import { config, missingConfig, validateConfig } from './config.js';
import { pool, query, transaction } from './db.js';
import { CATEGORIES, brevoSend, demoHtml, generateDemoCopy, generateEmail, makeUnsubscribeToken, publishDemo, verifyUnsubscribeToken } from './services.js';
import { publishJob, verifyQstash } from './qstash.js';

const COUNTRY_ISO2 = {
  'United States':'US','United Kingdom':'GB','Canada':'CA','Ireland':'IE','France':'FR','Germany':'DE','Netherlands':'NL','Belgium':'BE','Luxembourg':'LU','Switzerland':'CH','Austria':'AT','Spain':'ES','Portugal':'PT','Italy':'IT','Sweden':'SE','Norway':'NO','Denmark':'DK','Finland':'FI','Poland':'PL','Czechia':'CZ','Greece':'GR','Romania':'RO','Australia':'AU','New Zealand':'NZ','South Africa':'ZA','United Arab Emirates':'AE','Burkina Faso':'BF','Ghana':'GH'
};
const startupMissing = validateConfig();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
app.use((req,res,next)=>{
  const origin=req.get('origin');
  if(origin && origin===config.frontendOrigin){
    res.set('Access-Control-Allow-Origin',origin);
    res.set('Vary','Origin');
    res.set('Access-Control-Allow-Headers','Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    res.set('Access-Control-Max-Age','600');
  }
  if(req.method==='OPTIONS'){
    if(origin && origin!==config.frontendOrigin) return res.sendStatus(403);
    return res.sendStatus(204);
  }
  next();
});

function admin(req, res, next) {
  if (!config.adminToken) return res.status(503).json({ error: 'Service en mode dégradé', missing: ['ADMIN_TOKEN'] });
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !safeEqual(token, config.adminToken)) return res.status(401).json({ error: 'Unauthorized' });
  if (!config.databaseUrl) return res.status(503).json({ error: 'Service en mode dégradé', missing: ['DATABASE_URL'] });
  next();
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function validText(value, max = 100) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max; }
function validEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function randomBetween(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function qstashAuth() { return async (req, res, next) => (await verifyQstash(req)) ? next() : res.status(401).json({ error: 'Invalid QStash signature' }); }
function webhookKey(req) {
  const provided = req.query.key;
  return Boolean(config.brevoWebhookToken && typeof provided === 'string' && safeEqual(provided, config.brevoWebhookToken));
}

async function locateSearchArea(city, country) {
  if (!city) {
    const isoCode=COUNTRY_ISO2[country];
    if (!isoCode) throw new Error('Pays non pris en charge par le menu.');
    // Country-wide searches use OSM's ISO3166-1 boundary directly, avoiding
    // Nominatim's strict public rate limit for dropdown-based searches.
    return { isoCode, bbox:null };
  }
  const url = new URL(config.nominatimUrl);
  url.searchParams.set('city', city);
  url.searchParams.set('country', country);
  url.searchParams.set('format','jsonv2');
  url.searchParams.set('limit','1');
  const response = await fetch(url, { headers: { 'User-Agent': 'WebStudioLeadFinder/1.0 (contact configured by operator)' }, signal:AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const results = await response.json();
  const place = results[0];
  if (!place?.boundingbox) throw new Error('Ville introuvable pour ce pays.');
  return { areaId:null, isoCode:null, bbox:place.boundingbox.map(Number) };
}
function overpassQuery(location, category) {
  const box=location.bbox ? `${location.bbox[0]},${location.bbox[2]},${location.bbox[1]},${location.bbox[3]}` : '';
  const area=location.isoCode ? '(area.searchArea)' : `(${box})`;
  const countryArea=location.isoCode ? `area["ISO3166-1"="${location.isoCode}"]->.searchArea;` : '';
  const items = CATEGORIES[category].clauses.map(([key,value]) =>
    `node["${key}"${value === '*' ? '' : `="${value}"` }]["name"][!"website"]${area};way["${key}"${value === '*' ? '' : `="${value}"` }]["name"][!"website"]${area};relation["${key}"${value === '*' ? '' : `="${value}"` }]["name"][!"website"]${area};`
  ).join('\n');
  return `[out:json][timeout:100][maxsize:268435456];${countryArea}(${items});out center tags 1500;`;
}
function addressFromTags(t = {}) {
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  return [street, t['addr:suburb'], t['addr:city'], t['addr:postcode']].filter(Boolean).join(', ') || null;
}

async function fetchOverpass(location, category) {
  const data=overpassQuery(location,category);
  const endpoints=[...new Set([config.overpassUrl,config.overpassFallbackUrl].filter(Boolean))];
  let lastError;
  for(let i=0;i<endpoints.length;i++){
    try{
      const response=await fetch(endpoints[i],{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'AutoClientLeadFinder/1.0'},
        body:new URLSearchParams({data}),
        signal:AbortSignal.timeout(i===0?80_000:35_000),
      });
      if(response.ok) return await response.json();
      lastError=new Error(`HTTP ${response.status}`);
      if(![502,503,504].includes(response.status)||i===endpoints.length-1) throw lastError;
    }catch(error){
      lastError=error;
      const status=Number(error.message?.match(/HTTP (\d+)/)?.[1]||0);
      if((status&&!([502,503,504].includes(status)))||i===endpoints.length-1){
        const code=error.cause?.code;
        throw new Error(code?`fetch failed (${code})`:String(error.message||'fetch failed'));
      }
    }
  }
  throw new Error(String(lastError?.message||'Overpass unavailable'));
}

async function hunt({ country, city, category }) {
  let stage=city?'Nominatim':'Overpass';
  try {
    const location = await locateSearchArea(city, country);
    stage='Overpass';
    const data = await fetchOverpass(location,category);
    stage='Supabase';
    let created = 0, manual = 0, skipped = 0;
    const elements=data.elements || [];
    for (const el of elements) {
      const tags = el.tags || {};
      const rawEmail = tags['contact:email'] || tags.email || null;
      const email = rawEmail && validEmail(rawEmail.trim()) ? rawEmail.trim().toLowerCase() : null;
      const actualCity=String(tags['addr:city'] || city || 'Ville non renseignée').trim().slice(0,100);
      const result = await query(`insert into leads (osm_type,osm_id,country,city,category,name,address,phone,email,status)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing returning id`,
        [el.type, String(el.id), country.trim(), actualCity, category, String(tags.name).trim(), addressFromTags(tags), tags['contact:phone'] || tags.phone || null, email, email ? 'nouveau' : 'contact manuel']);
      if (result.rowCount) { created++; if (!email) manual++; await query('insert into events (lead_id,event_type,source,payload) values ($1,$2,$3,$4)', [result.rows[0].id,'lead_found','overpass',JSON.stringify({has_email:Boolean(email),category,city,country})]); }
      else skipped++;
    }
    return { found: created, manual, duplicates: skipped, scanned:elements.length, scope:city?'city':'country', limited:elements.length>=1500 };
  } catch (error) {
    error.stage ||= stage;
    throw error;
  }
}

async function ensureDemo(lead) {
  const existing = await query('select * from demos where lead_id=$1', [lead.id]);
  if (existing.rowCount) return existing.rows[0];
  const copy = await generateDemoCopy(lead);
  const published = await publishDemo(lead, copy);
  const result = await query('insert into demos (lead_id,slug,demo_url,content_json,github_path) values ($1,$2,$3,$4,$5) returning *', [lead.id,published.slug,published.url,JSON.stringify(copy),published.path]);
  await query("update leads set status='démo prête',updated_at=now() where id=$1",[lead.id]);
  await query('insert into events (lead_id,event_type,source,payload) values ($1,$2,$3,$4)',[lead.id,'demo_published','github',JSON.stringify({url:published.url})]);
  return result.rows[0];
}

async function canReserveInitial() {
  const res = await query(`select count(*)::int as n from emails where created_at >= date_trunc('day', now()) and sequence=0 and status in ('queued','sending','sent','delivered','opened','clicked','bounced')`);
  return res.rows[0].n < config.maxEmailsPerDay;
}
async function enqueueLead(lead) {
  if (!lead.email || (await query('select 1 from blocklist where email=lower($1)',[lead.email])).rowCount) return { result:'blocked_or_no_email' };
  const prev = await query('select id,status from emails where lead_id=$1 and sequence=0',[lead.id]);
  if (prev.rowCount) {
    if (!config.dryRun && prev.rows[0].status === 'dry_run') {
      const reserved = await transaction(async client => {
        await client.query("select pg_advisory_xact_lock(hashtext('daily-email-cap'))");
        const count = await client.query(`select count(*)::int as n from emails where created_at >= date_trunc('day',now()) and sequence=0 and status in ('queued','sending','sent','delivered','opened','clicked','bounced')`);
        if (count.rows[0].n >= config.maxEmailsPerDay) return false;
        const changed = await client.query("update emails set status='queued' where id=$1 and status='dry_run' returning id",[prev.rows[0].id]);
        return changed.rowCount === 1;
      });
      if (!reserved) return { result:'daily_limit' };
      const emailId = prev.rows[0].id;
      try { await publishJob('/jobs/send-email',{emailId},randomBetween(config.minDelaySeconds,config.maxDelaySeconds)); }
      catch (err) { await query("update emails set status='dry_run' where id=$1 and status='queued'",[emailId]); throw err; }
      await query("update leads set status='email en file',updated_at=now() where id=$1",[lead.id]);
      await query("insert into events (lead_id,email_id,event_type,source) values ($1,$2,'email_queued','system')",[lead.id,emailId]);
      return { result:'queued_from_dry_run', emailId };
    }
    return { result:'already_queued_or_contacted' };
  }
  const demo = await ensureDemo(lead);
  const generated = await generateEmail(lead,demo.demo_url,0);
  const token = makeUnsubscribeToken(lead.id);
  const optout = `${config.publicBaseUrl}/unsubscribe/${encodeURIComponent(token)}`;
  const body = `${generated.body}\n\nFree preview: ${demo.demo_url}\nUnsubscribe: ${optout}\n\n${config.senderName}\n${config.senderPostalAddress}`;
  const reserve = await transaction(async client => {
    await client.query("select pg_advisory_xact_lock(hashtext('daily-email-cap'))");
    const count = await client.query(`select count(*)::int as n from emails where created_at >= date_trunc('day', now()) and sequence=0 and status in ('queued','sending','sent','delivered','opened','clicked','bounced')`);
    if (count.rows[0].n >= config.maxEmailsPerDay) return null;
    const ins = await client.query(`insert into emails (lead_id,demo_id,sequence,subject,body_text,status) values ($1,$2,0,$3,$4,$5) returning id`, [lead.id,demo.id,generated.subject,body,config.dryRun?'dry_run':'queued']);
    return ins.rows[0].id;
  });
  if (!reserve) return { result:'daily_limit' };
  await query('insert into events (lead_id,email_id,event_type,source) values ($1,$2,$3,$4)',[lead.id,reserve,config.dryRun?'dry_run':'email_queued','system']);
  if (!config.dryRun) {
    const delay = randomBetween(config.minDelaySeconds,config.maxDelaySeconds);
    try { await publishJob('/jobs/send-email',{emailId:reserve},delay); }
    catch (err) { await query("update emails set status='failed' where id=$1",[reserve]); throw err; }
    await query("update leads set status='email en file',updated_at=now() where id=$1",[lead.id]);
  }
  return { result: config.dryRun ? 'dry_run' : 'queued', emailId: reserve, demoUrl: demo.demo_url };
}

async function sendLeadEmail(emailId) {
  const found = await query(`select e.*,l.id as lid,l.email as lead_email,l.name,l.country,l.city,l.category,l.phone,l.address,l.response_at,l.unsubscribed_at,d.demo_url
    from emails e join leads l on l.id=e.lead_id left join demos d on d.lead_id=l.id where e.id=$1`,[emailId]);
  if (!found.rowCount) return { skipped:'missing' };
  const row = found.rows[0];
  if (config.dryRun) {
    await query("update emails set status='dry_run' where id=$1 and status='queued'",[emailId]);
    return { dry_run:true };
  }
  const claim = await transaction(async client => {
    await client.query("select pg_advisory_xact_lock(hashtext('daily-email-send-cap'))");
    const current = await client.query(`select e.status,l.response_at,l.unsubscribed_at,l.email from emails e join leads l on l.id=e.lead_id where e.id=$1 for update`,[emailId]);
    if (!current.rowCount || current.rows[0].status!=='queued') return { skipped:'not_queued' };
    if (current.rows[0].response_at || current.rows[0].unsubscribed_at || (await client.query('select 1 from blocklist where email=lower($1)',[current.rows[0].email])).rowCount) {
      await client.query("update emails set status='cancelled' where id=$1",[emailId]); return { skipped:'ineligible' };
    }
    const count = await client.query(`select count(*)::int as n from emails where (status='sending' and claimed_at >= date_trunc('day',now())) or (sent_at >= date_trunc('day',now()) and status in ('sent','delivered','opened','clicked','bounced'))`);
    if (count.rows[0].n >= config.maxEmailsPerDay) return { reschedule:true };
    await client.query("update emails set status='sending',claimed_at=now() where id=$1",[emailId]);
    return { claimed:true };
  });
  if (claim.skipped) return claim;
  if (claim.reschedule) {
    const delay = Math.max(120, Math.ceil((new Date().setUTCHours(24,0,0,0)-Date.now())/1000));
    await publishJob('/jobs/send-email',{emailId},delay); return {rescheduled:'daily_limit'};
  }
  const unsub = `${config.publicBaseUrl}/unsubscribe/${encodeURIComponent(makeUnsubscribeToken(row.lid))}`;
  const text = `${row.body_text}\nUnsubscribe: ${unsub}`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px"><p>${escapeText(row.body_text).replace(/\n/g,'<br>')}</p><p><a href="${row.demo_url}">View your free website preview</a></p><p><a href="${unsub}">Unsubscribe</a></p><p>${escapeText(config.senderName)}<br>${escapeText(config.senderPostalAddress)}</p></div>`;
  let result;
  try { result = await brevoSend({ to:row.lead_email,subject:row.subject,text,html,replyTo:config.replyToEmail,tags:['lead-outreach',`sequence-${row.sequence}`] }); }
  catch (err) { await query("update emails set status='failed' where id=$1 and status='sending'",[emailId]); throw err; }
  await query("update emails set status='sent',sent_at=now(),brevo_message_id=$2 where id=$1",[emailId,result.messageId || null]);
  await query("update leads set status='contacté',updated_at=now() where id=$1",[row.lid]);
  await query('insert into events (lead_id,email_id,event_type,source,payload) values ($1,$2,$3,$4,$5)',[row.lid,emailId,'email_sent','brevo',JSON.stringify({messageId:result.messageId||null})]);
  await publishJob('/jobs/followup',{leadId:row.lid,sequence:1},3*86400);
  return { sent:true };
}

async function processFollowup(leadId, sequence) {
  if (![1,2].includes(Number(sequence))) return { skipped:'sequence' };
  const result = await query(`select l.*,d.demo_url from leads l join demos d on d.lead_id=l.id where l.id=$1`,[leadId]);
  if (!result.rowCount) return { skipped:'missing' };
  const lead = result.rows[0];
  if (lead.response_at || lead.unsubscribed_at || (await query('select 1 from blocklist where email=lower($1)',[lead.email])).rowCount) return { skipped:'responded_or_unsubscribed' };
  const prior = await query('select status from emails where lead_id=$1 and sequence=$2',[leadId,Number(sequence)-1]);
  if (!prior.rowCount || (Number(sequence)===2 && prior.rows[0].status!=='sent')) return { skipped:'prior_email_not_sent' };
  const generated = await generateEmail(lead,lead.demo_url,Number(sequence));
  const unsub = `${config.publicBaseUrl}/unsubscribe/${encodeURIComponent(makeUnsubscribeToken(leadId))}`;
  const body = `${generated.body}\n\nUnsubscribe: ${unsub}\n${config.senderName}\n${config.senderPostalAddress}`;
  let existing=await query(`insert into emails (lead_id,demo_id,sequence,subject,body_text,status) select $1,d.id,$2,$3,$4,'queued' from demos d where d.lead_id=$1 on conflict (lead_id,sequence) do nothing returning id,status`,[leadId,sequence,generated.subject,body]);
  let id, status;
  if (existing.rowCount) { id=existing.rows[0].id; status=existing.rows[0].status; }
  else {
    const old=await query('select id,status from emails where lead_id=$1 and sequence=$2',[leadId,sequence]);
    if (!old.rowCount || old.rows[0].status!=='queued') return { skipped:'duplicate' };
    ({id,status}=old.rows[0]);
  }
  if (status!=='queued') return { skipped:'duplicate' };
  if (config.dryRun) { await query("update emails set status='dry_run' where id=$1",[id]); return { dry_run:true }; }
  const claim=await transaction(async client=>{
    await client.query("select pg_advisory_xact_lock(hashtext('daily-email-send-cap'))");
    const current=await client.query('select status from emails where id=$1 for update',[id]);
    if (!current.rowCount || current.rows[0].status!=='queued') return {skipped:true};
    const count=await client.query(`select count(*)::int as n from emails where (status='sending' and claimed_at >= date_trunc('day',now())) or (sent_at >= date_trunc('day',now()) and status in ('sent','delivered','opened','clicked','bounced'))`);
    if (count.rows[0].n>=config.maxEmailsPerDay) return {limit:true};
    await client.query("update emails set status='sending',claimed_at=now() where id=$1",[id]);
    return {claimed:true};
  });
  if (claim.skipped) return {skipped:'duplicate'};
  if (claim.limit) {
    const delay=Math.max(120,Math.ceil((new Date().setUTCHours(24,0,0,0)-Date.now())/1000));
    await publishJob('/jobs/followup',{leadId,sequence},delay); return {rescheduled:'daily_limit'};
  }
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.6"><p>${escapeText(generated.body)}</p><p><a href="${lead.demo_url}">View the preview</a></p><p><a href="${unsub}">Unsubscribe</a></p><p>${escapeText(config.senderName)}<br>${escapeText(config.senderPostalAddress)}</p></div>`;
  let sent;
  try { sent=await brevoSend({to:lead.email,subject:generated.subject,text:body,html,replyTo:config.replyToEmail,tags:['lead-outreach',`sequence-${sequence}`]}); }
  catch(err) { await query("update emails set status='failed' where id=$1 and status='sending'",[id]); throw err; }
  await query("update emails set status='sent',sent_at=now(),brevo_message_id=$2 where id=$1",[id,sent.messageId||null]);
  await query('insert into events (lead_id,email_id,event_type,source,payload) values ($1,$2,$3,$4,$5)',[leadId,id,'email_sent','brevo',JSON.stringify({sequence,messageId:sent.messageId||null})]);
  if (Number(sequence)===1) await publishJob('/jobs/followup',{leadId,sequence:2},4*86400);
  return {sent:true,sequence};
}

function escapeText(value='') { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function ownerAlert(subject, text) {
  if (config.dryRun) return;
  await brevoSend({to:config.ownerEmail,subject,text,replyTo:config.replyToEmail,tags:['owner-alert']});
}
async function dailyDigest() {
  const stats = await query(`select
    (select count(*) from leads where created_at >= date_trunc('day',now()))::int as found,
    (select count(*) from emails where sent_at >= date_trunc('day',now()))::int as sent,
    (select count(*) from events where event_type='email_clicked' and created_at >= date_trunc('day',now()))::int as clicks,
    (select count(*) from leads where status='contact manuel' and created_at >= date_trunc('day',now()))::int as manual`);
  const manual = await query(`select name,city,country,phone,address from leads where status='contact manuel' and created_at >= date_trunc('day',now()) order by created_at desc limit 100`);
  const s = stats.rows[0];
  const lines = manual.rows.map(x=>`- ${x.name} — ${x.city}, ${x.country}${x.phone?` — ${x.phone}`:''}${x.address?` — ${x.address}`:''}`).join('\n') || '- Aucun';
  const body = `Daily prospecting digest\nFound: ${s.found}\nEmails sent: ${s.sent}\nClicks: ${s.clicks}\nManual follow-up (no email in OSM): ${s.manual}\n\n${lines}`;
  await ownerAlert(`Daily lead digest — ${new Date().toISOString().slice(0,10)}`,body);
  return { ...s, manualLeads:manual.rows };
}

app.get('/health', async (req,res) => {
  if (req.query.task === 'digest') {
    if (!(await verifyQstash(req))) return res.status(401).json({error:'Invalid QStash signature'});
    try { return res.json({ok:true,digest:await dailyDigest()}); }
    catch { return res.status(500).json({ok:false,error:'Digest failed'}); }
  }
  const missing = validateConfig();
  if (!config.databaseUrl) return res.status(200).json({ok:true,status:'degraded',service:'lead-studio',database:'not_configured',dryRun:config.dryRun,missing});
  try {
    await query('select 1');
    const tables=await query(`select to_regclass('public.leads') as leads,to_regclass('public.demos') as demos,to_regclass('public.emails') as emails,to_regclass('public.events') as events,to_regclass('public.blocklist') as blocklist`);
    const missingTables=Object.entries(tables.rows[0]).filter(([,value])=>!value).map(([name])=>name);
    const allMissing=[...missing,...missingTables.map(name=>`TABLE:${name}`)];
    return res.status(200).json({ok:true,status:allMissing.length?'degraded':'ready',service:'lead-studio',database:'ok',schema:missingTables.length?'incomplete':'ok',dryRun:config.dryRun,missing:allMissing});
  } catch {
    return res.status(503).json({ok:false,status:'database_unavailable',service:'lead-studio',database:'unavailable',dryRun:config.dryRun});
  }
});
app.post('/health',async(req,res)=>{
  if(req.query.task!=='digest' || !(await verifyQstash(req))) return res.status(401).json({error:'Invalid QStash task/signature'});
  try { res.json({ok:true,digest:await dailyDigest()}); }
  catch { res.status(500).json({ok:false,error:'Digest failed'}); }
});
app.get('/admin/leads',admin,async (req,res) => {
  const allowed=['nouveau','contact manuel','démo prête','email en file','contacté','répondu','désinscrit','rebondi','erreur'];
  const limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||30));
  const offset=Math.max(0,Number.parseInt(req.query.offset,10)||0);
  const status=typeof req.query.status==='string' ? req.query.status : '';
  if(status && !allowed.includes(status)) return res.status(400).json({error:'Invalid status filter'});
  try {
    const params=[]; const where=status ? 'where l.status=$1' : '';
    if(status) params.push(status);
    const total=await query(`select count(*)::int as total from leads l ${where}`,params);
    const result=await query(`select l.id,l.name,l.country,l.city,l.category,l.address,l.phone,l.email,l.status,l.created_at,d.demo_url,
      (select e.status from emails e where e.lead_id=l.id order by e.sequence desc limit 1) as last_email_status
      from leads l left join demos d on d.lead_id=l.id ${where} order by l.created_at desc limit $${params.length+1} offset $${params.length+2}`,[...params,limit,offset]);
    res.json({leads:result.rows,total:total.rows[0].total,limit,offset});
  } catch { res.status(500).json({error:'Leads unavailable'}); }
});

app.get('/stats',admin,async (_req,res) => {
  try {
    const out = await query(`select (select count(*)::int from leads) as leads,(select count(*)::int from leads where status='contact manuel') as manual_contacts,(select count(*)::int from demos) as demos,(select count(*)::int from emails where status in ('sent','delivered','opened','clicked')) as emails_sent,(select count(*)::int from events where event_type='email_clicked') as clicks,(select count(*)::int from leads where response_at is not null) as replies,(select count(*)::int from blocklist) as unsubscribed`);
    res.json({...out.rows[0],dryRun:config.dryRun,maxEmailsPerDay:config.maxEmailsPerDay});
  } catch { res.status(500).json({error:'Stats unavailable'}); }
});

app.post('/admin/hunt',admin,async (req,res) => {
  const {country,city,category}=req.body||{};
  const cityValue=typeof city==='string'?city.trim():'';
  if (!validText(country,100)||(cityValue && !validText(cityValue,100))||!Object.hasOwn(CATEGORIES,category)) return res.status(400).json({error:'country et category requis; city est facultative'});
  try { res.json(await hunt({country:country.trim(),city:cityValue,category})); }
  catch (err) {
    const detail=String(err.message||'Erreur inconnue').slice(0,180);
    console.error('hunt_failed',err.stage||'unknown',err.code||'',detail);
    res.status(502).json({error:`Échec à l’étape ${err.stage||'recherche'}.`,detail});
  }
});

app.post('/admin/process',admin,async (_req,res) => {
  const needed = config.dryRun
    ? ['PUBLIC_BASE_URL','UNSUBSCRIBE_SECRET','GROQ_API_KEY','GITHUB_TOKEN','GITHUB_REPO','GITHUB_PAGES_BASE_URL']
    : undefined;
  const missing = needed ? missingConfig(needed) : validateConfig();
  if (missing.length) return res.status(503).json({error:'Configuration incomplète pour le traitement',missing});
  try {
    const rows = await query(`select l.* from leads l where l.email is not null and l.status in ('nouveau','démo prête') and l.unsubscribed_at is null and not exists (select 1 from emails e where e.lead_id=l.id and e.sequence=0 and e.status <> 'dry_run') and not exists (select 1 from blocklist b where b.email=lower(l.email)) order by l.created_at asc limit 100`);
    const results=[];
    for (const lead of rows.rows) {
      if (!await canReserveInitial()) break;
      try { results.push({leadId:lead.id,...await enqueueLead(lead)}); }
      catch (err) { console.error('lead_process_failed',lead.id,err.message); results.push({leadId:lead.id,result:'error'}); }
    }
    res.json({processed:results.length,results,dryRun:config.dryRun});
  } catch { res.status(500).json({error:'Processing failed'}); }
});
app.post('/admin/digest',admin,async (_req,res) => {
  if (!config.dryRun) { const missing=validateConfig(); if (missing.length) return res.status(503).json({error:'Configuration incomplète pour l’envoi du digest',missing}); }
  try { res.json(await dailyDigest()); } catch { res.status(500).json({error:'Digest failed'}); }
});

app.get('/unsubscribe/:token',async (req,res) => {
  if (!config.unsubscribeSecret) return res.status(503).type('text').send('Unsubscribe is not configured yet.');
  const leadId = verifyUnsubscribeToken(req.params.token);
  if (!leadId) return res.status(400).type('text').send('Invalid unsubscribe link.');
  try {
    const found = await query('select email from leads where id=$1',[leadId]);
    if (!found.rowCount) return res.status(200).type('text').send('You are unsubscribed.');
    await transaction(async client => {
      await client.query('insert into blocklist(email,reason) values (lower($1),\'unsubscribe\') on conflict(email) do nothing',[found.rows[0].email]);
      await client.query("update leads set status='désinscrit',unsubscribed_at=now(),updated_at=now() where id=$1",[leadId]);
      await client.query("update emails set status='cancelled' where lead_id=$1 and status='queued'",[leadId]);
      await client.query("insert into events (lead_id,event_type,source) values ($1,'unsubscribe','link')",[leadId]);
    });
    res.status(200).type('text').send('You have been unsubscribed and will not receive further outreach.');
  } catch { res.status(500).type('text').send('Unable to process your request. Please try again.'); }
});

app.post('/webhooks/brevo',async (req,res) => {
  if (!config.brevoWebhookToken) return res.status(503).json({error:'Webhook not configured'});
  if (!webhookKey(req)) return res.status(401).json({error:'Unauthorized webhook'});
  const body=req.body||{}; const event=String(body.event||body.type||'').toLowerCase();
  const email=String(body.email||body.contact?.email||'').toLowerCase();
  const providerId=String(body.id||body.messageId||body['message-id']||'').slice(0,200)||null;
  if (!email || !event) return res.status(400).json({error:'Missing email or event'});
  const leadResult=await query('select id from leads where lower(email)=lower($1) order by created_at desc limit 1',[email]);
  const leadId=leadResult.rows[0]?.id||null;
  let eventType;
  if (['click','clicked'].includes(event)) eventType='email_clicked';
  else if (['opened','open'].includes(event)) eventType='email_opened';
  else if (['hard_bounce','soft_bounce','blocked','invalid','bounce'].includes(event)) eventType='email_bounced';
  else if (['unsubscribe','unsubscribed'].includes(event)) eventType='unsubscribe';
  else if (['reply','replied','inbound'].includes(event)) eventType='reply_received';
  else if (['delivered'].includes(event)) eventType='email_delivered';
  else return res.json({received:true,ignored:true});
  try {
    const saved=await query('insert into events (lead_id,event_type,source,provider_event_id,payload) values ($1,$2,$3,$4,$5) on conflict (provider_event_id) where provider_event_id is not null do nothing returning id',[leadId,eventType,'brevo',providerId,JSON.stringify(body)]);
    if (!saved.rowCount) return res.json({received:true,duplicate:true});
    let emailRow=null;
    if (leadId) {
      const er=await query('select id from emails where lead_id=$1 order by created_at desc limit 1',[leadId]); emailRow=er.rows[0]?.id;
      if (emailRow) await query('update events set email_id=$2 where id=$1',[saved.rows[0].id,emailRow]);
      if (eventType==='email_clicked' && emailRow) await query("update emails set click_count=click_count+1,status='clicked' where id=$1",[emailRow]);
      if (eventType==='email_opened' && emailRow) await query("update emails set status='opened' where id=$1 and status='sent'",[emailRow]);
      if (eventType==='email_delivered' && emailRow) await query("update emails set status='delivered' where id=$1 and status='sent'",[emailRow]);
      if (eventType==='email_bounced' && emailRow) { await query("update emails set status='bounced' where id=$1",[emailRow]); await query("update leads set status='rebondi' where id=$1",[leadId]); }
      if (eventType==='unsubscribe') {
        await query('insert into blocklist(email,reason) values (lower($1),\'brevo_unsubscribe\') on conflict(email) do nothing',[email]);
        if (leadId) { await query("update leads set status='désinscrit',unsubscribed_at=now() where id=$1",[leadId]); await query("update emails set status='cancelled' where lead_id=$1 and status='queued'",[leadId]); }
      }
      if (eventType==='reply_received') { await query("update leads set status='répondu',response_at=now() where id=$1",[leadId]); await ownerAlert('Reply received from a prospect',`${email} (${leadId}) replied. Check your reply-to inbox.`); }
      if (eventType==='email_clicked' && emailRow) {
        const clickCount=await query('select click_count from emails where id=$1',[emailRow]);
        if (clickCount.rows[0]?.click_count===3) await ownerAlert('Demo clicked multiple times',`${email} clicked the demo link at least three times.`);
      }
    }
    res.json({received:true,eventType});
  } catch { res.status(500).json({error:'Webhook processing failed'}); }
});

app.post('/webhooks/inbound',async (req,res) => {
  if (!config.brevoWebhookToken) return res.status(503).json({error:'Webhook not configured'});
  if (!webhookKey(req)) return res.status(401).json({error:'Unauthorized webhook'});
  const email=String(req.body?.from||req.body?.email||req.body?.sender||'').toLowerCase();
  if (!validEmail(email)) return res.status(400).json({error:'Valid from/email required'});
  const lead=await query('select id from leads where lower(email)=lower($1) order by created_at desc limit 1',[email]);
  if (!lead.rowCount) return res.json({received:true,matched:false});
  await query("insert into events (lead_id,event_type,source,payload) values ($1,'reply_received','inbound_webhook',$2)",[lead.rows[0].id,JSON.stringify({from:email})]);
  await query("update leads set status='répondu',response_at=now() where id=$1",[lead.rows[0].id]);
  await ownerAlert('Reply received from a prospect',`${email} replied. Check your Reply-To inbox.`);
  res.json({received:true,matched:true});
});

app.post('/jobs/send-email',qstashAuth(),async(req,res)=>{
  const id=req.body?.emailId;
  if (typeof id!=='string') return res.status(400).json({error:'emailId required'});
  try { res.json(await sendLeadEmail(id)); }
  catch(err) { console.error('send_job_failed',err.message); res.status(500).json({error:'Send job failed'}); }
});
app.post('/jobs/followup',qstashAuth(),async(req,res)=>{
  const {leadId,sequence}=req.body||{};
  if (typeof leadId!=='string' || ![1,2].includes(Number(sequence))) return res.status(400).json({error:'leadId and sequence 1 or 2 required'});
  try { res.json(await processFollowup(leadId,Number(sequence))); }
  catch(err) { console.error('followup_job_failed',err.message); res.status(500).json({error:'Follow-up job failed'}); }
});

app.use((err,_req,res,_next)=>{ console.error('request_error',err.message); res.status(400).json({error:'Invalid request'}); });
const server=app.listen(config.port,'0.0.0.0',()=>console.log(`lead-studio listening on ${config.port}; dryRun=${config.dryRun}; status=${startupMissing.length?'degraded':'ready'}; missing=${startupMissing.join(',')||'none'}`));
process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0);}));
process.on('SIGINT',()=>server.close(async()=>{await pool.end();process.exit(0);}));
