import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadAssets } from './assets'
import { LoadError } from './LoadState'
import AssetsList from './AssetsList'
import AssetDetail from './AssetDetail'

export default function AssetsView() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const retry = () => setReloadKey((k) => k + 1)
  const [openName, setOpenName] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loadAssets()
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  if (!isSupabaseConfigured) {
    return (
      <div className="wrap">
        <div className="state err">
          Supabase is not configured. Fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
          .env.local and restart the dev server.
        </div>
      </div>
    )
  }
  if (error) return <div className="wrap"><LoadError message={error} onRetry={retry} /></div>
  if (!data || loading) return <div className="wrap"><div className="state">Loading assets…</div></div>

  const asset = openName ? data.assets.find((a) => a.name === openName) : null
  return asset ? (
    <AssetDetail asset={asset} equipCodeLabels={data.equipCodeLabels} onBack={() => setOpenName(null)} />
  ) : (
    <AssetsList data={data} onOpen={(a) => setOpenName(a.name)} />
  )
}
