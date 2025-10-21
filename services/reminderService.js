import { sendToMakeWebhook } from './makeService.js';
export async function checkAndSendReminders(){
  if(!process.env.MAKE_WEBHOOK_URL) throw new Error('MAKE_WEBHOOK_URL not configured');
  try{
    await sendToMakeWebhook({action:'get_pending_orders'}, 'get_pending_orders');
    return true;
  }catch(err){
    console.error('Reminder check failed', err);
    throw err;
  }
}
