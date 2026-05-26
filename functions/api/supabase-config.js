export async function onRequest(context) {
  const url = context.env.SUPABASE_URL || '';
  const anonKey = context.env.SUPABASE_ANON_KEY || '';

  return new Response(JSON.stringify({ url, anonKey }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
