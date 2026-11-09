import 'dotenv/config';

const bool = (value, fallback) => value == null ? fallback : value.toLowerCase() === 'true';

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  dryRun: bool(process.env.DRY_RUN, true),
  adminToken: process.env.ADMIN_TOKEN || '',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: bool(process.env.DATABASE_SSL, true),
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  githubToken: process.env.GITHUB_TOKEN || '',
  githubRepo: process.env.GITHUB_REPO || '',
  githubBranch: process.env.GITHUB_BRANCH || 'main',
  githubPagesBaseUrl: process.env.GITHUB_PAGES_BASE_URL || '',
  brevoApiKey: process.env.BREVO_API_KEY || '',
  brevoWebhookToken: process.env.BREVO_WEBHOOK_TOKEN || '',
  senderEmail: process.env.SENDER_EMAIL || '',
  senderName: process.env.SENDER_NAME || 'Web Studio',
  senderPostalAddress: process.env.SENDER_POSTAL_ADDRESS || '',
  replyToEmail: process.env.REPLY_TO_EMAIL || '',
  ownerEmail: process.env.OWNER_EMAIL || '',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  frontendOrigin: (process.env.FRONTEND_ORIGIN || 'https://emstronglezin-cmd.github.io').replace(/\/$/, ''),
  qstashToken: process.env.QSTASH_TOKEN || '',
  qstashCurrentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || '',
  qstashNextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || '',
  maxEmailsPerDay: Math.max(1, Number(process.env.MAX_EMAILS_PER_DAY || 40)),
  minDelaySeconds: Math.max(0, Number(process.env.MIN_DELAY_SECONDS || 180)),
  maxDelaySeconds: Math.max(1, Number(process.env.MAX_DELAY_SECONDS || 2400)),
  unsubscribeSecret: process.env.UNSUBSCRIBE_SECRET || '',
  overpassUrl: process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  overpassFallbackUrl: process.env.OVERPASS_FALLBACK_URL || 'https://overpass.kumi.systems/api/interpreter',
  nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search',
};

const BASE_ENV = ['ADMIN_TOKEN', 'DATABASE_URL', 'PUBLIC_BASE_URL', 'UNSUBSCRIBE_SECRET'];
const LIVE_ENV = [
  'GROQ_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_PAGES_BASE_URL',
  'BREVO_API_KEY', 'SENDER_EMAIL', 'SENDER_POSTAL_ADDRESS', 'REPLY_TO_EMAIL',
  'OWNER_EMAIL', 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY', 'BREVO_WEBHOOK_TOKEN',
];

export function missingConfig(keys = [...BASE_ENV, ...(!config.dryRun ? LIVE_ENV : [])]) {
  const missing = keys.filter(key => !String(process.env[key] || '').trim());
  if (keys.includes('ADMIN_TOKEN') && config.adminToken && config.adminToken.length < 24) missing.push('ADMIN_TOKEN (minimum 24 caractères)');
  if (keys.includes('UNSUBSCRIBE_SECRET') && config.unsubscribeSecret && config.unsubscribeSecret.length < 32) missing.push('UNSUBSCRIBE_SECRET (minimum 32 caractères)');
  if (keys.includes('PUBLIC_BASE_URL') && config.publicBaseUrl && !config.publicBaseUrl.startsWith('https://')) missing.push('PUBLIC_BASE_URL (doit être HTTPS)');
  if (keys.includes('MAX_EMAILS_PER_DAY') && !Number.isFinite(config.maxEmailsPerDay)) missing.push('MAX_EMAILS_PER_DAY (entier positif)');
  if (config.minDelaySeconds > config.maxDelaySeconds) missing.push('MIN_DELAY_SECONDS/MAX_DELAY_SECONDS (plage invalide)');
  return [...new Set(missing)];
}

// Startup is intentionally tolerant: Render can deploy a healthy, degraded service
// before secrets are entered. Sensitive/admin operations enforce their own requirements.
export function validateConfig() {
  return missingConfig();
}
