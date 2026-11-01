import crypto from 'node:crypto';
import { config } from './config.js';

export const CATEGORIES = {
  salon: { label: 'salon', clauses: [['shop','hairdresser'], ['shop','beauty']] },
  clinique: { label: 'clinic', clauses: [['amenity','clinic'], ['healthcare','clinic'], ['healthcare','doctor'], ['amenity','doctors']] },
  restaurant: { label: 'restaurant', clauses: [['amenity','restaurant'], ['amenity','cafe'], ['amenity','fast_food']] },
  artisan: { label: 'craft business', clauses: [['craft','*'], ['shop','carpenter'], ['shop','electrician'], ['shop','plumber']] },
};

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function makeUnsubscribeToken(leadId) {
  const sig = crypto.createHmac('sha256', config.unsubscribeSecret).update(leadId).digest('hex');
  return `${leadId}.${sig}`;
}

export function verifyUnsubscribeToken(token) {
  const [id, sig, extra] = String(token || '').split('.');
  if (!id || !sig || extra || !/^[a-f0-9]{64}$/i.test(sig)) return null;
  const expected = crypto.createHmac('sha256', config.unsubscribeSecret).update(id).digest();
  let actual;
  try { actual = Buffer.from(sig, 'hex'); } catch { return null; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? id : null;
}

export function demoHtml(lead, content, previewName = lead.name) {
  const accent = ({ salon: '#c026d3', clinique: '#0f766e', restaurant: '#b45309', artisan: '#2563eb' })[lead.category] || '#4f46e5';
  const services = (content.services || []).slice(0, 3).map(s => `<li class="rounded-2xl bg-white p-6 shadow-sm">${escapeHtml(s)}</li>`).join('');
  const hours = (content.hours || []).map(h => `<li class="flex justify-between gap-4 border-b border-slate-200 py-2"><span>${escapeHtml(h.day)}</span><span>${escapeHtml(h.hours)} <small>(à confirmer)</small></span></li>`).join('');
  const phone = lead.phone ? `<a class="rounded-full bg-slate-900 px-5 py-3 text-white" href="tel:${escapeHtml(lead.phone.replace(/[^+\d]/g,''))}">${escapeHtml(content.contact_button || 'Contact us')}</a>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(lead.name)} | ${escapeHtml(content.headline || lead.category)}</title><script src="https://cdn.tailwindcss.com"></script><style>:root{--accent:${accent}}body{font-family:Inter,ui-sans-serif,system-ui,sans-serif}.accent-text{color:var(--accent)}.accent-bg{background-color:var(--accent)}.hero{background:radial-gradient(ellipse at 75% 20%,color-mix(in srgb,var(--accent) 22%,white),transparent 35%),linear-gradient(135deg,#f8fafc,#eff6ff)}.placeholder{background:linear-gradient(135deg,#e2e8f0,#cbd5e1);min-height:230px;border-radius:1.5rem;display:grid;place-items:center;color:#475569;font-weight:600}</style></head><body class="bg-slate-50 text-slate-900"><div class="sticky top-0 z-10 accent-bg px-4 py-3 text-center text-sm font-semibold text-white">Aperçu gratuit préparé pour ${escapeHtml(previewName)} · Concept uniquement</div><header class="mx-auto flex max-w-6xl items-center justify-between px-6 py-6"><a class="text-xl font-bold" href="#top">${escapeHtml(lead.name)}</a><nav class="hidden gap-6 text-sm md:flex"><a href="#services">Services</a><a href="#about">About</a><a href="#contact">Contact</a></nav></header><main id="top"><section class="hero"><div class="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 md:grid-cols-2 md:py-28"><div><p class="mb-4 font-semibold uppercase tracking-widest accent-text">${escapeHtml(content.eyebrow || lead.category)}</p><h1 class="text-4xl font-bold leading-tight md:text-6xl">${escapeHtml(content.headline || `Welcome to ${lead.name}`)}</h1><p class="mt-6 max-w-xl text-lg leading-8 text-slate-600">${escapeHtml(content.description || '')}</p><div id="contact" class="mt-8 flex flex-wrap gap-3">${phone}<a class="rounded-full border border-slate-300 bg-white px-5 py-3" href="mailto:${escapeHtml(lead.email || '')}">${escapeHtml(content.contact_button || 'Get in touch')}</a></div></div><div class="placeholder" role="img" aria-label="Image placeholder">A place for your own photo</div></div></section><section id="services" class="mx-auto max-w-6xl px-6 py-20"><p class="font-semibold uppercase tracking-widest accent-text">What we do</p><h2 class="mt-3 text-3xl font-bold">Thoughtful service, made for you.</h2><ul class="mt-8 grid gap-4 md:grid-cols-3">${services}</ul></section><section id="about" class="bg-white"><div class="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-2"><div><p class="font-semibold uppercase tracking-widest accent-text">Visit us</p><h2 class="mt-3 text-3xl font-bold">Local, friendly, and here to help.</h2><p class="mt-5 leading-7 text-slate-600">A welcoming place to discover ${escapeHtml(lead.category)} services. This preview is a concept; all details should be reviewed by the business before publication.</p></div><div><h3 class="mb-3 text-xl font-bold">Suggested opening hours</h3><ul class="text-sm text-slate-600">${hours}</ul><p class="mt-3 text-xs text-amber-800">Fictional suggested hours — please confirm before use.</p></div></div></section><section class="mx-auto max-w-6xl px-6 py-16"><div class="rounded-3xl bg-indigo-950 p-8 text-white md:flex md:items-center md:justify-between"><div><h2 class="text-2xl font-bold">We’d love to hear from you.</h2><p class="mt-2 text-indigo-200">${escapeHtml(lead.address || '')}</p></div><a class="mt-6 inline-block rounded-full bg-white px-6 py-3 font-semibold text-indigo-950 md:mt-0" href="mailto:${escapeHtml(lead.email || '')}">${escapeHtml(content.contact_button || 'Contact us')}</a></div></section></main><footer class="border-t border-slate-200 px-6 py-8 text-center text-sm text-slate-500">© ${new Date().getFullYear()} ${escapeHtml(lead.name)} · Preview only, not an official website.</footer></body></html>`;
}

async function groqJson(system, user) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.groqModel, temperature: 0.55, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!response.ok) throw new Error(`Groq API error ${response.status}`);
  const data = await response.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

export async function generateDemoCopy(lead) {
  const json = await groqJson(
    'Return only valid JSON. Write concise, plausible English marketing copy for a clearly marked concept website. Never invent credentials, awards, claims, reviews, precise business facts, or factual opening hours. Opening hours are fictional suggestions and each must be marked to confirm. Provide headline, eyebrow, description, exactly 3 services, 5 suggested day/hour pairs, and contact_button.',
    JSON.stringify({ business: lead.name, category: lead.category, city: lead.city, country: lead.country, requested_schema: { headline: 'string', eyebrow: 'string', description: 'string', services: ['string','string','string'], hours: [{day:'Monday',hours:'9:00 AM – 5:00 PM (à confirmer)'}], contact_button:'string' } }),
  );
  return {
    headline: String(json.headline || `Welcome to ${lead.name}`).slice(0, 120),
    eyebrow: String(json.eyebrow || lead.category).slice(0, 60),
    description: String(json.description || `Discover local ${lead.category} services in ${lead.city}.`).slice(0, 500),
    services: Array.isArray(json.services) ? [...json.services.slice(0,3).map(x => String(x).slice(0,100)), 'Personal service','Expert guidance','Easy appointments'].slice(0,3) : ['Personal service','Expert guidance','Easy appointments'],
    hours: Array.isArray(json.hours) && json.hours.length ? json.hours.slice(0,5).map(x => ({ day: String(x.day || 'Day').slice(0,20), hours: `${String(x.hours || 'Hours to confirm').slice(0,50)} (à confirmer)` })) : [{day:'Monday–Friday',hours:'9:00 AM–5:00 PM (à confirmer)'},{day:'Saturday',hours:'10:00 AM–2:00 PM (à confirmer)'},{day:'Sunday',hours:'Closed (à confirmer)'}],
    contact_button: String(json.contact_button || 'Get in touch').slice(0,40),
  };
}

export async function generateEmail(lead, demoUrl, sequence = 0) {
  const instructions = sequence === 0
    ? 'Write a short, polite cold outreach email in English, 80 words maximum, personalized using only given business facts. Clearly identify the sender as the web studio. Offer a complete 1–3 page website delivered in 48 hours, starting at $350. Link the supplied concept preview. End with exactly one question. No fabricated claims.'
    : `Write a brief, polite follow-up number ${sequence} in English, 55 words maximum, no pressure. Include the supplied demo link and one clear question at the end. Do not claim they viewed it.`;
  const json = await groqJson(instructions + ' Return JSON with subject and body.', JSON.stringify({ business: lead.name, category: lead.category, city: lead.city, demo_url: demoUrl, sender: config.senderName, sequence }));
  return { subject: String(json.subject || (sequence ? `A quick follow-up for ${lead.name}` : `A website concept for ${lead.name}`)).slice(0,160), body: String(json.body || `Hello, I made a free website concept for ${lead.name}: ${demoUrl}. I build complete 1–3 page websites in 48 hours, starting at $350. Would you be open to taking a look?`).slice(0,1800) };
}

export async function publishDemo(lead, content) {
  const slug = crypto.randomBytes(14).toString('hex');
  const path = `${slug}/index.html`;
  const html = demoHtml(lead, content);
  const url = `https://api.github.com/repos/${config.githubRepo}/contents/${path}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${config.githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Add private preview ${slug}`, content: Buffer.from(html).toString('base64'), branch: config.githubBranch }),
  });
  if (!response.ok) throw new Error(`GitHub publish error ${response.status}`);
  return { slug, path, url: `${config.githubPagesBaseUrl.replace(/\/$/,'')}/${slug}/` };
}

export async function brevoSend({ to, subject, text, html, replyTo, tags = [] }) {
  const payload = {
    sender: { name: config.senderName, email: config.senderEmail },
    to: [{ email: to }], subject, textContent: text, ...(html ? { htmlContent: html } : {}),
    ...(replyTo ? { replyTo: { email: replyTo } } : {}), tags,
  };
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': config.brevoApiKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Brevo API error ${response.status}`);
  return response.json();
}
