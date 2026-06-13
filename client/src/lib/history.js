import { supabase } from './supabase'

export async function saveTranscript({ filename, result }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('transcripts')
    .insert({ user_id: user.id, filename, result })
    .select()
    .single()

  if (error) {
    console.error('履歴保存エラー:', error)
    return null
  }
  return data
}

export async function fetchTranscripts() {
  const { data, error } = await supabase
    .from('transcripts')
    .select('id, filename, created_at, result')
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    console.error('履歴取得エラー:', error)
    return []
  }
  return data
}

export async function deleteTranscript(id) {
  const { error } = await supabase
    .from('transcripts')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('履歴削除エラー:', error)
    return false
  }
  return true
}
