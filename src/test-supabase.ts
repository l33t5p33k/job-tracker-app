import { supabase } from './supabaseClient'

async function test() {
  const { data, error } = await supabase.from('jobs').select('*')
  console.log('data:', data)
  console.log('error:', error)
}

test()