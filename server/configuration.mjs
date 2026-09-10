import {origin} from './http.mjs';
import {storeTarget} from './store.mjs';
import {configuredProviders} from './identity.mjs';
import {capabilities} from './ai.mjs';

/** Public readiness contains flags and variable names, never secret values. */
export function configuration(env) {
  const test = env.LOCAL_TEST_MODE === '1' && !env.VERCEL;
  let validOrigin = false, validDatabase = false, databaseMessage = '';
  try { origin(env); validOrigin = true; } catch {}
  try { storeTarget(env); validDatabase = true; } catch (error) {
    databaseMessage = error.message;
  }
  const email = typeof env.OWNER_EMAIL === 'string' ? env.OWNER_EMAIL.trim() : '';
  const validOwner = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
  const providers = configuredProviders(env);
  const emailConfigured = !!env.RESEND_API_KEY && !!env.MAIL_FROM;
  const checks = [
    {id:'database',label:'Neon Postgres',ready:validDatabase,keys:['DATABASE_URL'],
      ...(databaseMessage ? {message:databaseMessage} : {})},
    {id:'origin',label:'Public URL',ready:validOrigin,keys:['APP_ORIGIN']},
    {id:'owner',label:'Workspace owner',ready:validOwner||test,keys:['OWNER_EMAIL']},
    {id:'login',label:'Sign-in provider',ready:providers.length>0||emailConfigured||test,
      keys:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET',
        'SLACK_CLIENT_ID','SLACK_CLIENT_SECRET','RESEND_API_KEY','MAIL_FROM']},
  ];
  return {ready:checks.every(check=>check.ready),checks,test,providers,email:emailConfigured,
    ai:capabilities(env),integrations:{slack:!!env.SLACK_BOT_TOKEN,
      github:!!env.GITHUB_TOKEN,linear:!!env.LINEAR_API_KEY}};
}
