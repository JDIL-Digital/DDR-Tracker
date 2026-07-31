import { fmt1, prettyDate, DASH } from './format'

function Field({ k, v, pending }) {
  return (
    <div className="field-row">
      <span className="k">{k}</span>
      <span className="v">{v}{pending ? <span className="pending-badge">pending GTO</span> : null}</span>
    </div>
  )
}

export default function AssetDetail({ asset, equipCodeLabels, onBack }) {
  const dt = asset.downtime || []
  const dtTotal = dt.reduce((s, e) => s + (e.hrs || 0), 0)

  return (
    <div className="wrap">
      <div className="detail-head">
        <button type="button" className="back-btn" onClick={onBack}>← Back to inventory</button>
        <h2 style={{ fontSize: 17 }}>{asset.name}</h2>
        <span className={`pill ${asset.pill}`}>{asset.status}</span>
      </div>

      <div className="detail-grid">
        {/* Identity — reference fields, editable later */}
        <div className="panel accent" style={{ '--k': 'var(--green)' }}>
          <h3>Identity</h3>
          <div className="psub">Reference details · editable later</div>
          <Field k="Name" v={asset.name} />
          <Field k="Asset ID" v={asset.dbId ? asset.dbId.slice(0, 8) : DASH} />
          <Field k="Type" v={asset.type || DASH} />
          <Field k="Parent rig" v={asset.parentRig || DASH} />
          <Field k="Commissioned" v={asset.commissioned ? prettyDate(asset.commissioned) : DASH} />
          <Field k="Registered in DB" v={asset.registered ? 'Yes' : 'No'} />
        </div>

        {/* Current well / project — comes from the GTO later, NOT the DDR */}
        <div className="panel accent" style={{ '--k': 'var(--blue)' }}>
          <h3>Current well / project</h3>
          <div className="pending-gto">
            Pending GTO upload — this record is populated from the GTO in a later feature, not from the DDR.
          </div>
          <Field k="Well name" v={DASH} pending />
          <Field k="Block / field" v={DASH} pending />
          <Field k="Well type" v={DASH} pending />
          <Field k="Target depth (m)" v={DASH} pending />
          <Field k="Water depth (m)" v={DASH} pending />
          {asset.currentWell ? (
            <div className="pending-note" style={{ marginTop: 10, marginBottom: 0 }}>
              For reference, the latest DDR reports well <strong>{asset.currentWell}</strong> — the authoritative
              well/project record still loads from the GTO.
            </div>
          ) : null}
        </div>

        {/* Certifications — placeholder only */}
        <div className="panel accent" style={{ '--k': 'var(--amber)' }}>
          <h3>Certifications</h3>
          <div className="pending-gto">
            To be configured. Certification categories and their structure will be defined in a later feature.
          </div>
        </div>

        {/* Equipment downtime — LIVE from repair/breakdown codes */}
        <div className="panel accent" style={{ '--k': 'var(--red)' }}>
          <h3>Equipment downtime</h3>
          <div className="psub">
            Live from repair/equipment codes{equipCodeLabels?.length ? ` (${equipCodeLabels.join('; ')})` : ''} · all reports for this rig
          </div>
          {dt.length === 0 ? (
            <div className="npt-empty">No equipment-downtime activities logged for this asset.</div>
          ) : (
            <>
              <div className="npt-kpis">
                <div className="npt-kpi">
                  <div className="npt-kpi-num mono" style={{ color: 'var(--red)' }}>{fmt1(dtTotal)}<small> h</small></div>
                  <div className="npt-kpi-lbl">Total downtime · {dt.length} event{dt.length === 1 ? '' : 's'}</div>
                </div>
              </div>
              <div className="matrix-scroll">
                <table className="matrix">
                  <thead>
                    <tr><th>Date</th><th className="num">Hours</th><th>Code</th><th>Remark</th></tr>
                  </thead>
                  <tbody>
                    {dt.map((e, i) => (
                      <tr key={i}>
                        <td className="mono">{prettyDate(e.date)}</td>
                        <td className="num mono">{fmt1(e.hrs)}</td>
                        <td className="mono">{e.code}</td>
                        <td className="remark-cell">{e.remark || DASH}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
