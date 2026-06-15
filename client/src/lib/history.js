import { supabase } from './supabase'

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

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
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return []

  const res = await fetch(`${API_BASE}/api/transcripts`, {
    headers: { 'Authorization': `Bearer ${session.access_token}` },
  })
  if (!res.ok) return []
  return res.json()
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
