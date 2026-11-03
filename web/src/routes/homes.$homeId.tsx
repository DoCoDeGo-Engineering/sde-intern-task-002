import { createFileRoute, Link } from '@tanstack/react-router'
import { type FormEvent, useCallback, useRef, useState } from 'react'
import {
  addMember,
  type Balance,
  type Bill,
  createBill,
  getHome,
  type HomeDetails,
  listBalances,
  listBills,
  payShare,
} from '../api'
import { formatCents, parseToCents } from '../money'
import { useLoad } from '../useLoad'

export const Route = createFileRoute('/homes/$homeId')({
  component: HomePage,
})

type PageData = { home: HomeDetails; bills: Bill[]; balances: Balance[] }

function HomePage() {
  const { homeId } = Route.useParams()

  const load = useCallback(
    async (signal: AbortSignal): Promise<PageData> => {
      const [home, bills, balances] = await Promise.all([
        getHome(homeId, signal),
        listBills(homeId, signal),
        listBalances(homeId, signal),
      ])
      return { home, bills, balances }
    },
    [homeId],
  )
  const { state, reload, retry } = useLoad(load)

  if (state.status === 'loading') {
    return (
      <main className="page">
        <p>Loading the home...</p>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main className="page">
        <p>
          <Link to="/">Back to all homes</Link>
        </p>
        <div role="alert" className="error">
          <p>{state.message}</p>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </div>
      </main>
    )
  }

  const { home, bills, balances } = state.data

  return (
    <main className="page">
      <p>
        <Link to="/">Back to all homes</Link>
      </p>
      <h1>{home.name}</h1>

      <MembersSection home={home} onChange={reload} />
      <BalancesSection balances={balances} />
      <NewBillSection homeId={home.id} hasMembers={home.members.length > 0} onChange={reload} />
      <BillsSection home={home} bills={bills} onChange={reload} />
    </main>
  )
}

function MembersSection(props: { home: HomeDetails; onChange: () => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      await addMember(props.home.id, name)
      setName('')
      props.onChange()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the member.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h2>Members</h2>
      {props.home.members.length === 0 ? (
        <p className="empty">Nobody lives here yet. Add a member before adding a bill.</p>
      ) : (
        <ol className="list">
          {props.home.members.map((member) => (
            <li key={member.id}>{member.name}</li>
          ))}
        </ol>
      )}
      <form onSubmit={onSubmit} className="row">
        <label htmlFor="member-name">Name</label>
        <input
          id="member-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          required
        />
        <button type="submit" disabled={saving}>
          {saving ? 'Adding...' : 'Add member'}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  )
}

function BalancesSection(props: { balances: Balance[] }) {
  if (props.balances.length === 0) {
    return null
  }

  return (
    <section>
      <h2>Still to pay</h2>
      <table>
        <tbody>
          {props.balances.map((balance) => (
            <tr key={balance.memberId}>
              <td>{balance.name}</td>
              <td className="money">{formatCents(balance.outstandingCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function NewBillSection(props: { homeId: string; hasMembers: boolean; onChange: () => void }) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const totalCents = parseToCents(amount)
    if (totalCents === null) {
      setError('Write the amount in dollars, like 25 or 25.50. It must be more than 0.')
      return
    }

    setSaving(true)
    try {
      await createBill(props.homeId, title, totalCents)
      setTitle('')
      setAmount('')
      props.onChange()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the bill.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h2>Add a bill</h2>
      <form onSubmit={onSubmit} className="row">
        <label htmlFor="bill-title">Title</label>
        <input
          id="bill-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={100}
          required
        />
        <label htmlFor="bill-amount">Amount ($)</label>
        <input
          id="bill-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          required
        />
        <button type="submit" disabled={saving || !props.hasMembers}>
          {saving ? 'Adding...' : 'Add bill'}
        </button>
      </form>
      {!props.hasMembers && <p className="empty">Add at least one member first.</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  )
}

function BillsSection(props: { home: HomeDetails; bills: Bill[]; onChange: () => void }) {
  const [paying, setPaying] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  /*
    One Idempotency-Key for each share. It is made on the first click and kept
    until the payment works. If the first try times out, the second click sends
    the same key, so the server knows it is the same payment and does not
    take the money twice.
  */
  const keys = useRef(new Map<string, string>())

  const memberNames = new Map(props.home.members.map((member) => [member.id, member.name]))

  async function onPay(billId: string, shareId: string) {
    let key = keys.current.get(shareId)
    if (!key) {
      key = crypto.randomUUID()
      keys.current.set(shareId, key)
    }

    setPaying((before) => new Set(before).add(shareId))
    setErrors((before) => ({ ...before, [shareId]: '' }))

    try {
      await payShare(billId, shareId, key)
      keys.current.delete(shareId)
      props.onChange()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The payment did not work.'
      setErrors((before) => ({ ...before, [shareId]: message }))
    } finally {
      setPaying((before) => {
        const after = new Set(before)
        after.delete(shareId)
        return after
      })
    }
  }

  return (
    <section>
      <h2>Bills</h2>
      {props.bills.length === 0 && <p className="empty">There are no bills yet.</p>}
      {props.bills.map((bill) => (
        <article key={bill.id} className="bill">
          <h3>
            {bill.title} <span className="money">{formatCents(bill.totalCents)}</span>
          </h3>
          <ul className="shares">
            {bill.shares.map((share) => (
              <li key={share.id}>
                <span>{memberNames.get(share.memberId) ?? 'Unknown member'}</span>
                <span className="money">{formatCents(share.amountCents)}</span>
                {share.paidAt ? (
                  <span className="paid">
                    Paid on {new Date(share.paidAt).toLocaleDateString()}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onPay(bill.id, share.id)}
                    disabled={paying.has(share.id)}
                  >
                    {paying.has(share.id) ? 'Paying...' : 'Pay'}
                  </button>
                )}
                {errors[share.id] && (
                  <span role="alert" className="error">
                    {errors[share.id]} The share is still unpaid.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  )
}
