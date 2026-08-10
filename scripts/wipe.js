import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log('Wiping database...');
  
  // Disable timeouts or just let it run.
  
  // 1. Delete line items
  console.log('Deleting quote_line_items...');
  const { error: lineItemsError } = await db.from('quote_line_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (lineItemsError) console.error(lineItemsError);
  
  // 2. Delete quotes
  console.log('Deleting quotes...');
  const { error: quotesError } = await db.from('quotes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (quotesError) console.error(quotesError);
  
  // 3. Delete suppliers
  console.log('Deleting suppliers...');
  const { error: supError } = await db.from('suppliers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (supError) console.error(supError);

  // 4. Delete source_documents
  console.log('Deleting source_documents...');
  const { error: sError } = await db.from('source_documents').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (sError) console.error(sError);
  
  // 5. Delete ingestion_runs
  console.log('Deleting ingestion_runs...');
  const { error: runError } = await db.from('ingestion_runs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (runError) console.error(runError);

  console.log('✅ Database wiped successfully! You can now re-upload the sample quotes.');
}

main().catch(console.error);
