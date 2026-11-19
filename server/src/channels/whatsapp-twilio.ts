import { runDecisionPipeline } from '../ai/pipeline.ts';
import { detectLanguage, translateReply } from './languages.ts';

export interface WhatsAppWebhookResponse {
  ok: true;
}

export async function handleWhatsAppMessage(
  message: string,
  from: string,
  to: string,
): Promise<boolean> {
  if (!message.trim() || !from) return false;
  const language = detectLanguage(message);
  const result = await runDecisionPipeline({
    message,
    sessionId: `whatsapp:${from}`,
    shopper: {},
  });
  const reply = translateReply(result.reply, language).slice(0, 1600);
  return sendTwilioMessage(to, from, reply);
}

async function sendTwilioMessage(to: string, from: string, body: string): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !authToken || !fromNumber) return false;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const payload = new URLSearchParams({ To: to, From: fromNumber, Body: body });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
  });
  return response.ok;
}
