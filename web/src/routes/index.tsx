import { createFileRoute } from '@tanstack/react-router'
import { type CSSProperties, useCallback, useRef, useState } from 'react'

interface Home {
  id: string
  name: string
}
interface Member {
  id: string
  homeId: string
  name: string
}
interface Share {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}
interface Bill {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
interface Balance {
  memberId: string
  name: string
  outstandingCents: number
}
interface ApiErrorBody {
  error: string
}

async function request(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let data: unknown = null
  if (text.length > 0) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    let message = `request failed (${response.status})`
    if (data !== null && typeof data === 'object' && 'error' in data) {
      const error = (data as ApiErrorBody).error
      if (typeof error === 'string') {
        message = error
      }
    }
    throw new Error(message)
  }
  return data
}

function isHome(value: unknown): value is Home {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Home).id === 'string' &&
    typeof (value as Home).name === 'string'
  )
}

function isMember(value: unknown): value is Member {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Member).id === 'string' &&
    typeof (value as Member).homeId === 'string' &&
    typeof (value as Member).name === 'string'
  )
}

function isShare(value: unknown): value is Share {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Share).id === 'string' &&
    typeof (value as Share).memberId === 'string' &&
    typeof (value as Share).amountCents === 'number' &&
    ((value as Share).paidAt === null || typeof (value as Share).paidAt === 'string')
  )
}

function isArrayOfShares(value: unknown): value is Share[] {
  return Array.isArray(value) && value.every(isShare)
}

function isBill(value: unknown): value is Bill {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Bill).id === 'string' &&
    typeof (value as Bill).homeId === 'string' &&
    typeof (value as Bill).title === 'string' &&
    typeof (value as Bill).totalCents === 'number' &&
    isArrayOfShares((value as Bill).shares)
  )
}

function isBalance(value: unknown): value is Balance {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Balance).memberId === 'string' &&
    typeof (value as Balance).name === 'string' &&
    typeof (value as Balance).outstandingCents === 'number'
  )
}

function isArrayOfBalances(value: unknown): value is Balance[] {
  return Array.isArray(value) && value.every(isBalance)
}

function isArrayOfMembers(value: unknown): value is Member[] {
  return Array.isArray(value) && value.every(isMember)
}

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const [mode, setMode] = useState<'select' | 'view'>('select')
  const [homeIdInput, setHomeIdInput] = useState('')
  const [homeId, setHomeId] = useState<string | null>(null)
  const [homeName, setHomeName] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [loading, setLoading] = useState(false)
  const [paying, setPaying] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const memberNameRef = useRef<HTMLInputElement>(null)
  const billTitleRef = useRef<HTMLInputElement>(null)
  const billTotalRef = useRef<HTMLInputElement>(null)

  const clearError = useCallback(() => setError(null), [])

  const loadHomeData = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const membersData = await request(`/api/homes/${id}/members`)
      if (!isArrayOfMembers(membersData)) throw new Error('unexpected members response')
      setMembers(membersData)

      setBills([])

      const balancesData = await request(`/api/homes/${id}/balances`)
      if (
        balancesData === null ||
        typeof balancesData !== 'object' ||
        !isArrayOfBalances((balancesData as { balances: unknown }).balances)
      ) {
        throw new Error('unexpected balances response')
      }
      setBalances((balancesData as { balances: Balance[] }).balances)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load home')
    } finally {
      setLoading(false)
    }
  }, [])

  const openHome = useCallback(async () => {
    const id = homeIdInput.trim()
    if (!id) {
      setError('enter a home id')
      return
    }
    setError(null)
    setLoading(true)
    try {
      setHomeName(id)
      setHomeId(id)
      setMode('view')
      await loadHomeData(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not open home')
    } finally {
      setLoading(false)
    }
  }, [homeIdInput, loadHomeData])

  const createHome = useCallback(async () => {
    const name = prompt('enter a name for the new home')
    if (!name) return
    setError(null)
    setLoading(true)
    try {
      const created = (await request('/api/homes', {
        method: 'POST',
        body: { name },
      })) as { id: string; name: string }
      if (!isHome(created)) throw new Error('unexpected home response')
      setHomeName(created.name)
      setHomeId(created.id)
      setMode('view')
      await loadHomeData(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not create home')
    } finally {
      setLoading(false)
    }
  }, [loadHomeData])

  const addMember = useCallback(async () => {
    const input = memberNameRef.current
    const name = input?.value.trim()
    if (!input || !homeId || !name) {
      setError('enter a member name')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const created = (await request(`/api/homes/${homeId}/members`, {
        method: 'POST',
        body: { name },
      })) as Member
      if (!isMember(created)) throw new Error('unexpected member response')
      setMembers((prev) => [...prev, created])
      input.value = ''
      input.focus()
      await loadHomeData(homeId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not add member')
    } finally {
      setLoading(false)
    }
  }, [homeId, loadHomeData])

  const createBill = useCallback(async () => {
    const titleInput = billTitleRef.current
    const totalInput = billTotalRef.current
    const title = titleInput?.value.trim()
    const totalCents = Number(totalInput?.value.trim())
    if (
      !titleInput ||
      !totalInput ||
      !homeId ||
      !title ||
      !Number.isInteger(totalCents) ||
      totalCents <= 0
    ) {
      setError('enter a title and a positive whole amount in cents')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const created = (await request(`/api/homes/${homeId}/bills`, {
        method: 'POST',
        body: { title, totalCents },
      })) as Bill
      if (!isBill(created)) throw new Error('unexpected bill response')
      setBills((prev) => [created, ...prev])
      titleInput.value = ''
      totalInput.value = ''
      await loadHomeData(homeId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not create bill')
    } finally {
      setLoading(false)
    }
  }, [homeId, loadHomeData])

  const payShare = useCallback(
    async (billId: string, share: Share) => {
      if (paying.has(share.id)) return
      if (!homeId) return
      const key = crypto.randomUUID()
      setPaying((prev) => {
        const next = new Set(prev)
        next.add(share.id)
        return next
      })
      setError(null)
      try {
        await request(`/api/bills/${billId}/shares/${share.id}/pay`, {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
        })
        await loadHomeData(homeId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'payment failed')
      } finally {
        setPaying((prev) => {
          const next = new Set(prev)
          next.delete(share.id)
          return next
        })
      }
    },
    [homeId, paying, loadHomeData],
  )

  const memberDisplayName = useCallback(
    (memberId: string) => members.find((member) => member.id === memberId)?.name ?? memberId,
    [members],
  )

  const amountText = (cents: number) => {
    const dollars = (cents / 100).toFixed(2)
    return `$${dollars}`
  }

  if (mode === 'select') {
    return (
      <main style={pageStyle}>
        <h1>Bill Splitter</h1>
        <p>Split shared bills between members of a home.</p>
        <section style={cardStyle}>
          <h2>Open a home</h2>
          <div style={inputGroupStyle}>
            <label htmlFor="home-id">Home id</label>
            <input
              id="home-id"
              value={homeIdInput}
              onChange={(e) => setHomeIdInput(e.target.value)}
              placeholder="paste a home id"
            />
            <button
              type="button"
              onClick={openHome}
              disabled={loading || homeIdInput.trim().length === 0}
            >
              {loading ? 'Opening...' : 'Open home'}
            </button>
          </div>
          <button type="button" onClick={createHome} disabled={loading}>
            {loading ? 'Creating...' : 'Create a new home'}
          </button>
        </section>
        {error && <ErrorBanner message={error} onDismiss={clearError} />}
      </main>
    )
  }

  const currentHomeId = homeId ?? ''

  return (
    <main style={pageStyle}>
      <div style={headerStyle}>
        <h1>Bill Splitter — {homeName}</h1>
        <p>Home id: {currentHomeId}</p>
        <button type="button" onClick={() => setMode('select')}>
          Choose a different home
        </button>
      </div>
      {error && <ErrorBanner message={error} onDismiss={clearError} />}

      <section style={cardStyle}>
        <h2>Add a member</h2>
        <div style={inputGroupStyle}>
          <label htmlFor="member-name">Member name</label>
          <input id="member-name" ref={memberNameRef} placeholder="e.g. Asha" disabled={loading} />
          <button type="button" onClick={addMember} disabled={loading}>
            {loading ? 'Adding...' : 'Add member'}
          </button>
        </div>
        {members.length === 0 && (
          <p style={emptyStyle}>No members yet. Add a member to start splitting bills.</p>
        )}
        <ul style={memberListStyle}>
          {members.map((member) => (
            <li key={member.id}>{member.name}</li>
          ))}
        </ul>
      </section>

      <section style={cardStyle}>
        <h2>Create a bill</h2>
        <div style={inputGroupStyle}>
          <label htmlFor="bill-title">Title</label>
          <input
            id="bill-title"
            ref={billTitleRef}
            placeholder="e.g. Electricity"
            disabled={loading}
          />
        </div>
        <div style={inputGroupStyle}>
          <label htmlFor="bill-total">Total (cents)</label>
          <input
            id="bill-total"
            ref={billTotalRef}
            type="number"
            min="0"
            placeholder="e.g. 1000"
            disabled={loading}
          />
        </div>
        <button type="button" onClick={createBill} disabled={loading}>
          {loading ? 'Creating...' : 'Create bill'}
        </button>
      </section>

      <section style={cardStyle}>
        <h2>Balances</h2>
        {balances.length === 0 ? (
          <p style={emptyStyle}>No balances yet.</p>
        ) : (
          <ul style={balanceListStyle}>
            {balances.map((balance) => (
              <li key={balance.memberId} style={balanceItemStyle}>
                <span>{balance.name}</span>
                <span style={amountStyle}>{amountText(balance.outstandingCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={cardStyle}>
        <h2>Bills</h2>
        {bills.length === 0 ? (
          <p style={emptyStyle}>No bills yet. Create a bill to split it between members.</p>
        ) : (
          bills.map((bill) => (
            <article key={bill.id} style={billCardStyle}>
              <header style={billHeaderStyle}>
                <h3>{bill.title}</h3>
                <span style={amountStyle}>{amountText(bill.totalCents)}</span>
              </header>
              <ul style={shareListStyle}>
                {bill.shares.map((share) => {
                  const paid = share.paidAt !== null
                  return (
                    <li key={share.id} style={shareItemStyle}>
                      <span>{memberDisplayName(share.memberId)}</span>
                      <span style={amountStyle}>{amountText(share.amountCents)}</span>
                      <span style={paid ? paidStyle : unpaidStyle}>{paid ? 'paid' : 'unpaid'}</span>
                      {!paid && (
                        <button
                          type="button"
                          onClick={() => payShare(bill.id, share)}
                          disabled={paying.has(share.id) || loading}
                          aria-busy={paying.has(share.id)}
                        >
                          {paying.has(share.id) ? 'paying...' : 'pay'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </article>
          ))
        )}
      </section>
    </main>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div style={errorBannerStyle} role="alert" aria-live="polite">
      {message}
      <button type="button" onClick={onDismiss} style={errorDismissStyle}>
        dismiss
      </button>
    </div>
  )
}

const pageStyle: CSSProperties = {
  padding: 24,
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#1a1a1a',
  maxWidth: 720,
  margin: '0 auto',
}
const cardStyle: CSSProperties = {
  border: '1px solid #e5e7ea',
  borderRadius: 10,
  padding: 20,
  marginBottom: 16,
  background: '#ffffff',
}
const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 16,
}
const inputGroupStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginBottom: 10,
  flexWrap: 'wrap',
}
const emptyStyle: CSSProperties = {
  color: '#6b7280',
  fontStyle: 'italic',
  margin: 8,
}
const memberListStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}
const balanceListStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}
const balanceItemStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '6px 0',
  borderBottom: '1px solid #f1f3f5',
}
const amountStyle: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  color: '#4b5563',
}
const paidStyle: CSSProperties = { color: '#15803d', fontWeight: 600 }
const unpaidStyle: CSSProperties = { color: '#b45309', fontWeight: 600 }
const billCardStyle: CSSProperties = {
  border: '1px solid #e5e7ea',
  borderRadius: 8,
  padding: 14,
  marginBottom: 10,
  background: '#fafbfc',
}
const billHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
}
const shareListStyle: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}
const shareItemStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 4px',
}
const errorBannerStyle: CSSProperties = {
  background: '#fef3f3',
  border: '1px solid #fecaca',
  color: '#991b1b',
  padding: 10,
  borderRadius: 6,
  marginBottom: 12,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}
const errorDismissStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid #fecaca',
  color: '#991b1b',
  borderRadius: 4,
  padding: '2px 8px',
  cursor: 'pointer',
}
