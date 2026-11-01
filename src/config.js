import 'dotenv/config';

const bool = (value, fallback) => value == null ? fallback : value.toLowerCase() === 'true';
const requiredWhenLive = (key, value) => {
  if (!value) throw new Error(`Configuration manquante : ${key}`);
  return value;
};

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
  qstashToken: process.env.QSTASH_TOKEN || '',
  qstashCurrentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || '',
  qstashNextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || '',
  maxEmailsPerDay: Math.max(1, Number(process.env.MAX_EMAILS_PER_DAY || 40)),
  minDelaySeconds: Math.max(0, Number(process.env.MIN_DELAY_SECONDS || 180)),
  maxDelaySeconds: Math.max(1, Number(process.env.MAX_DELAY_SECONDS || 2400)),
  unsubscribeSecret: process.env.UNSUBSCRIBE_SECRET || '',
  overpassUrl: process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search',
};

export function validateConfig() {
  const basics = ['ADMIN_TOKEN', 'DATABASE_URL', 'PUBLIC_BASE_URL', 'UNSUBSCRIBE_SECRET'];
  for (const key of basics) requiredWhenLive(key, process.env[key]);
  if (config.adminToken.length < 24) throw new Error('ADMIN_TOKEN doit contenir au moins 24 caractères.');
  if (config.unsubscribeSecret.length < 32) throw new Error('UNSUBSCRIBE_SECRET doit contenir au moins 32 caractères.');
  if (config.maxEmailsPerDay < 1 || !Number.isFinite(config.maxEmailsPerDay)) throw new Error('MAX_EMAILS_PER_DAY doit être un entier positif.');
  if (config.minDelaySeconds > config.maxDelaySeconds) throw new Error('MIN_DELAY_SECONDS doit être inférieur ou égal à MAX_DELAY_SECONDS.');
  if (!config.publicBaseUrl.startsWith('https://')) throw new Error('PUBLIC_BASE_URL doit commencer par https://');
  if (!config.dryRun) {
    for (const key of ['GROQ_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_PAGES_BASE_URL', 'BREVO_API_KEY', 'SENDER_EMAIL', 'SENDER_POSTAL_ADDRESS', 'REPLY_TO_EMAIL', 'OWNER_EMAIL', 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'BREVO_WEBHOOK_TOKEN']) requiredWhenLive(key, process.env[key]);
  }
}
