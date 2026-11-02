import { createFileRoute, type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router'
import { useRef } from 'react'
import { api, type Balance, type Bill, type Home, money, type Share, useFormAction } from '../api'

export const Route = createFileRoute('/homes/$homeId')({
  loader: async ({ params }) => {
    const path = `/api/homes/${encodeURIComponent(params.homeId)}`
    const [home, { bills }, { balances }] = await Promise.all([
      api<Home>(path),
      api<{ bills: Bill[] }>(`${path}/bills`),
      api<{ balances: Balance[] }>(`${path}/balances`),
    ])
    return { home, bills, balances }
  },
  pendingComponent: () => (
    <main>
      <p role="status">Loading home…</p>
    </main>
  ),
  errorComponent: LoadError,
  component: HomePage,
})

function LoadError({ error }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <main>
      <p role="alert">
        Could not load this home: {error instanceof Error ? error.message : 'Unknown error.'}
      </p>
      <button type="button" onClick={() => router.invalidate()}>
        Try again
      </button>
    </main>
  )
}

function HomePage() {
  const { home, bills, balances } = Route.useLoaderData()
  const names = new Map(balances.map((balance) => [balance.memberId, balance.name]))

  return (
    <main>
      <Link to="/">← New home</Link>
      <h1>{home.name}</h1>

      <section>
        <h2>Members</h2>
        {balances.length === 0 ? (
          <p className="muted">No members yet. Add one before adding a bill.</p>
        ) : (
          <ul>
            {balances.map((balance) => (
              <li key={balance.memberId}>
                {balance.name} owes {money(balance.outstandingCents)}
              </li>
            ))}
          </ul>
        )}
        <AddMember homeId={home.id} />
      </section>

      <section>
        <h2>Bills</h2>
        <AddBill homeId={home.id} />
        {bills.length === 0 ? (
          <p className="muted">No bills yet.</p>
        ) : (
          bills.map((bill) => (
            <article key={bill.id} className="card">
              <h3>
                {bill.title} · {money(bill.totalCents)}
              </h3>
              <ul>
                {bill.shares.map((share) => (
                  <ShareRow
                    key={share.id}
                    billId={bill.id}
                    share={share}
                    name={names.get(share.memberId) ?? 'Unknown member'}
                  />
                ))}
              </ul>
            </article>
          ))
        )}
      </section>
    </main>
  )
}

function AddMember({ homeId }: { homeId: string }) {
  const router = useRouter()
  const [error, add, adding] = useFormAction(async (form) => {
    await api(`/api/homes/${homeId}/members`, { method: 'POST', body: { name: form.get('name') } })
    await router.invalidate()
  })

  return (
    <form action={add} className="row">
      <input name="name" aria-label="Member name" required maxLength={100} placeholder="Name" />
      <button type="submit" disabled={adding}>
        {adding ? 'Adding…' : 'Add member'}
      </button>
      {error && <span role="alert">{error}</span>}
    </form>
  )
}

function AddBill({ homeId }: { homeId: string }) {
  const router = useRouter()
  const [error, add, adding] = useFormAction(async (form) => {
    // The input allows at most 2 decimals, so rounding only removes float noise (12.34 * 100).
    const totalCents = Math.round(Number(form.get('total')) * 100)
    await api(`/api/homes/${homeId}/bills`, {
      method: 'POST',
      body: { title: form.get('title'), totalCents },
    })
    await router.invalidate()
  })

  return (
    <form action={add} className="row">
      <input name="title" aria-label="Bill title" required maxLength={100} placeholder="Title" />
      <input
        name="total"
        aria-label="Total in dollars"
        type="number"
        required
        min="0.01"
        step="0.01"
        placeholder="0.00"
      />
      <button type="submit" disabled={adding}>
        {adding ? 'Adding…' : 'Add bill'}
      </button>
      {error && <span role="alert">{error}</span>}
    </form>
  )
}

function ShareRow({ billId, share, name }: { billId: string; share: Share; name: string }) {
  const router = useRouter()
  // Kept across retries, so retrying a payment that timed out but went through is not a double pay.
  const idempotencyKey = useRef<string | null>(null)
  const [error, pay, paying] = useFormAction(async () => {
    idempotencyKey.current ??= crypto.randomUUID()
    await api(`/api/bills/${billId}/shares/${share.id}/pay`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey.current },
    })
    await router.invalidate()
  })

  return (
    <li className="row">
      <span>
        {name}: {money(share.amountCents)}
      </span>
      {share.paidAt ? (
        <span className="paid">Paid {new Date(share.paidAt).toLocaleString()}</span>
      ) : (
        <form action={pay}>
          <button type="submit" disabled={paying}>
            {paying ? 'Paying…' : 'Pay'}
          </button>
        </form>
      )}
      {error && <span role="alert">{error}</span>}
    </li>
  )
}
