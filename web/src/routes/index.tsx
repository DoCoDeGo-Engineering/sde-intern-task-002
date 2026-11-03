import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  addMember,
  type Balance,
  type Bill,
  createBill,
  createHome,
  errorMessage,
  listBalances,
  listBills,
  listHomes,
  payShare,
  type Share,
} from '../api'
import { formatCents, parseDollars } from '../money'
import { useResource } from '../useResource'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { home?: string } =>
    typeof search.home === 'string' && search.home !== '' ? { home: search.home } : {},
  component: HomePage,
})

function HomePage() {
  const { home: homeId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const homes = useResource(listHomes)

  const fetchHomeData = useMemo(
    () =>
      homeId
        ? async (signal: AbortSignal) => {
            const [bills, balances] = await Promise.all([
              listBills(homeId, signal),
              listBalances(homeId, signal),
            ])
            return { homeId, bills, balances }
          }
        : null,
    [homeId],
  )
  const homeData = useResource(fetchHomeData)

  function selectHome(id: string | undefined) {
    void navigate({ search: id ? { home: id } : {} })
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Bill Splitter</h1>
        <HomePicker
          homes={homes.data}
          loading={homes.loading}
          error={homes.error}
          selectedId={homeId}
          onSelect={selectHome}
          onRetry={homes.reload}
          onCreated={async (id) => {
            await homes.reload()
            selectHome(id)
          }}
        />
      </header>

      {!homeId ? (
        <p className="empty">Pick a home or create one to start splitting bills.</p>
      ) : (
        <HomeView
          key={homeId}
          homeId={homeId}
          data={homeData.data?.homeId === homeId ? homeData.data : null}
          loading={homeData.loading}
          error={homeData.error}
          reload={homeData.reload}
        />
      )}
    </main>
  )
}

function HomePicker(props: {
  homes: { id: string; name: string }[] | null
  loading: boolean
  error: string | null
  selectedId: string | undefined
  onSelect: (id: string | undefined) => void
  onRetry: () => void
  onCreated: (id: string) => Promise<void>
}) {
  const { homes, selectedId } = props

  return (
    <div className="home-picker">
      {props.error ? (
        <ErrorMessage message={`Could not load homes. ${props.error}`} onRetry={props.onRetry} />
      ) : homes === null ? (
        <Loading label="Loading homes" />
      ) : homes.length > 0 ? (
        <label className="field">
          <span>Home</span>
          <select
            value={selectedId ?? ''}
            onChange={(event) => props.onSelect(event.target.value || undefined)}
          >
            <option value="">Choose a home…</option>
            {selectedId && !homes.some((home) => home.id === selectedId) && (
              <option value={selectedId}>Unknown home</option>
            )}
            {homes.map((home) => (
              <option key={home.id} value={home.id}>
                {home.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <TextForm
        label="New home"
        placeholder="Flat 4B"
        button="Create home"
        onSubmit={async (name) => {
          const home = await createHome(name)
          await props.onCreated(home.id)
        }}
      />
    </div>
  )
}

type HomeData = { bills: Bill[]; balances: Balance[] }

function HomeView(props: {
  homeId: string
  data: HomeData | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}) {
  const { data, homeId } = props

  if (data === null) {
    return props.error ? (
      <ErrorMessage message={props.error} onRetry={props.reload} />
    ) : (
      <Loading label="Loading bills" />
    )
  }

  const names = new Map(data.balances.map((balance) => [balance.memberId, balance.name]))

  return (
    <div className="layout">
      {props.error && (
        <ErrorMessage
          wide
          message={`Could not refresh. Showing the last saved data. ${props.error}`}
          onRetry={props.reload}
        />
      )}

      <section className="card" aria-labelledby="members-title">
        <div className="card-title">
          <h2 id="members-title">Members</h2>
          {props.loading && <Loading label="Refreshing" small />}
        </div>
        {data.balances.length === 0 ? (
          <p className="empty">No members yet. Add the people who share this home.</p>
        ) : (
          <ul className="balances">
            {data.balances.map((balance) => (
              <li key={balance.memberId}>
                <span>{balance.name}</span>
                <span className={balance.outstandingCents === 0 ? 'muted' : 'owes'}>
                  {balance.outstandingCents === 0
                    ? 'Settled'
                    : `Owes ${formatCents(balance.outstandingCents)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <TextForm
          label="Add member"
          placeholder="Asha"
          button="Add"
          onSubmit={async (name) => {
            await addMember(homeId, name)
            await props.reload()
          }}
        />
      </section>

      <section className="card" aria-labelledby="new-bill-title">
        <h2 id="new-bill-title">New bill</h2>
        <NewBillForm
          homeId={homeId}
          hasMembers={data.balances.length > 0}
          onCreated={props.reload}
        />
      </section>

      <section className="wide" aria-labelledby="bills-title">
        <h2 id="bills-title">Bills</h2>
        <BillList bills={data.bills} names={names} reload={props.reload} />
      </section>
    </div>
  )
}

function NewBillForm(props: {
  homeId: string
  hasMembers: boolean
  onCreated: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    const totalCents = parseDollars(amount)
    if (title.trim() === '') return setError('Give the bill a title.')
    if (totalCents === null) return setError('Enter an amount like 12 or 12.50, more than 0.')

    setSubmitting(true)
    setError(null)
    try {
      await createBill(props.homeId, title.trim(), totalCents)
      setTitle('')
      setAmount('')
      await props.onCreated()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  if (!props.hasMembers) {
    return <p className="empty">Add at least one member before adding a bill.</p>
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="field">
        <span>Title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Electricity"
        />
      </label>
      <label className="field">
        <span>Amount ($)</span>
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="10.00"
          inputMode="decimal"
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Adding…' : 'Add bill'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  )
}

function BillList(props: {
  bills: Bill[]
  names: Map<string, string>
  reload: () => Promise<void>
}) {
  const inFlight = useRef(new Set<string>())
  const [paying, setPaying] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const keys = useRef(new Map<string, string>())
  const [confirmed, setConfirmed] = useState<Record<string, Share>>({})

  function setPayingFlag(shareId: string, on: boolean) {
    if (on) inFlight.current.add(shareId)
    else inFlight.current.delete(shareId)
    setPaying(new Set(inFlight.current))
  }

  function setError(shareId: string, message: string | null) {
    setErrors((previous) => {
      const { [shareId]: _, ...rest } = previous
      return message === null ? rest : { ...rest, [shareId]: message }
    })
  }

  async function pay(billId: string, shareId: string) {
    if (inFlight.current.has(shareId)) return
    const key = keys.current.get(shareId) ?? crypto.randomUUID()
    keys.current.set(shareId, key)
    setPayingFlag(shareId, true)
    setError(shareId, null)

    try {
      const share = await payShare(billId, shareId, key)
      keys.current.delete(shareId)
      setConfirmed((previous) => ({ ...previous, [shareId]: share }))
    } catch (caught) {
      if (caught instanceof ApiError && caught.mayHaveSucceeded) {
        setError(shareId, `${caught.message} The payment may not have gone through. Try again.`)
      } else {
        keys.current.delete(shareId)
        const message =
          caught instanceof ApiError && caught.status === 409
            ? 'This share was already paid by someone else.'
            : errorMessage(caught)
        setError(shareId, message)
      }
    } finally {
      await props.reload()
      setPayingFlag(shareId, false)
    }
  }

  if (props.bills.length === 0) {
    return <p className="empty card">No bills yet. Add one above to split it.</p>
  }

  return (
    <ul className="bill-list">
      {props.bills.map((bill) => {
        const shares = bill.shares.map((share) => confirmed[share.id] ?? share)
        const paidCount = shares.filter((share) => share.paidAt !== null).length
        return (
          <li key={bill.id} className="card">
            <div className="card-title">
              <h3>{bill.title}</h3>
              <span className="amount">{formatCents(bill.totalCents)}</span>
            </div>
            <p className="muted small">
              {paidCount} of {shares.length} shares paid
            </p>
            <ul className="shares">
              {shares.map((share) => (
                <ShareRow
                  key={share.id}
                  share={share}
                  name={props.names.get(share.memberId) ?? 'Unknown member'}
                  paying={paying.has(share.id)}
                  error={errors[share.id] ?? null}
                  onPay={() => pay(bill.id, share.id)}
                />
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

function ShareRow(props: {
  share: Share
  name: string
  paying: boolean
  error: string | null
  onPay: () => void
}) {
  const { share } = props
  const paid = share.paidAt !== null

  return (
    <li className="share">
      <div className="share-main">
        <span className="share-name">{props.name}</span>
        <span className="amount">{formatCents(share.amountCents)}</span>
        {paid ? (
          <span className="badge paid" title={share.paidAt ?? undefined}>
            Paid
          </span>
        ) : (
          <button
            type="button"
            className="pay"
            onClick={props.onPay}
            disabled={props.paying}
            aria-label={`Pay ${formatCents(share.amountCents)} for ${props.name}`}
          >
            {props.paying ? 'Paying…' : 'Pay'}
          </button>
        )}
      </div>
      {props.error && !paid && (
        <p className="error-text" role="alert">
          {props.error}
        </p>
      )}
    </li>
  )
}

function TextForm(props: {
  label: string
  placeholder: string
  button: string
  onSubmit: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    if (value.trim() === '') return setError('Enter a name.')
    setSubmitting(true)
    setError(null)
    try {
      await props.onSubmit(value.trim())
      setValue('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="form inline" onSubmit={submit} noValidate>
      <label className="field">
        <span>{props.label}</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={props.placeholder}
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : props.button}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  )
}

function Loading(props: { label: string; small?: boolean }) {
  return (
    <p className={props.small ? 'loading small' : 'loading'} role="status">
      <span className="spinner" aria-hidden="true" />
      {props.label}…
    </p>
  )
}

function ErrorMessage(props: { message: string; onRetry: () => void; wide?: boolean }) {
  return (
    <div className={props.wide ? 'error-box wide' : 'error-box'} role="alert">
      <span>{props.message}</span>
      <button type="button" className="secondary" onClick={props.onRetry}>
        Try again
      </button>
    </div>
  )
}
