import { Client, Receiver } from '@upstash/qstash';
import { config } from './config.js';

let client;
let receiver;
function getClient() {
  if (!config.qstashToken) throw new Error('QSTASH_TOKEN absent');
  client ||= new Client({ token: config.qstashToken });
  return client;
}
function getReceiver() {
  if (!config.qstashCurrentSigningKey || !config.qstashNextSigningKey) throw new Error('Clés de signature QStash absentes');
  receiver ||= new Receiver({ currentSigningKey: config.qstashCurrentSigningKey, nextSigningKey: config.qstashNextSigningKey });
  return receiver;
}
export async function publishJob(path, body, delaySeconds = 0) {
  return getClient().publishJSON({
    url: `${config.publicBaseUrl}${path}`,
    body,
    ...(delaySeconds > 0 ? { delay: String(Math.floor(delaySeconds)) } : {}),
    retries: 3,
  });
}
export async function verifyQstash(req) {
  const signature = req.get('upstash-signature');
  if (!signature) return false;
  try {
    return await getReceiver().verify({ signature, body: req.rawBody || '', url: `${config.publicBaseUrl}${req.originalUrl}` });
  } catch { return false; }
}
