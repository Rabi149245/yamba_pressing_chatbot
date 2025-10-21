import axios from 'axios';
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
export async function sendToMakeWebhook(payload, event='event'){ 
  if(!MAKE_WEBHOOK_URL) throw new Error('MAKE_WEBHOOK_URL not configured');
  try{
    await axios.post(MAKE_WEBHOOK_URL, {event, payload, ts: new Date().toISOString()}, { timeout: 10000 });
    return true;
  }catch(err){
    console.error('Make webhook error:', err.response?.data || err.message);
    throw err;
  }
}
