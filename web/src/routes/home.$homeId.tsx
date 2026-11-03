import { createFileRoute, Link } from '@tanstack/react-router'
import { type FormEvent, useCallback, useRef, useState } from 'react'
import { showMoney, typedToCents } from '../cents'
import {
  type BillData,
  type HomeFull,
  loadBills,
  loadHome,
  loadOwed,
  type Owed,
  postMember,
  postPayment,
  submitBill,
} from '../server'
import { useAsync } from '../useAsync'

export const Route = createFileRoute('/home/$homeId')({
  component: HomeScreen,
})

type Everything = { homeData: HomeFull; billList: BillData[]; owedList: Owed[] }

function HomeScreen() {
  const { homeId } = Route.useParams()

  const fetchEverything = useCallback(
    async (stop: AbortSignal): Promise<Everything> => {
      const [homeData, billList, owedList] = await Promise.all([
        loadHome(homeId, stop),
        loadBills(homeId, stop),
        loadOwed(homeId, stop),
      ])
      return { homeData, billList, owedList }
    },
    [homeId],
  )
  const { progress, reloadAll, startOver } = useAsync(fetchEverything)

  if (progress.phase === 'loading') {
    return (
      <main className="wrap">
        <p>Loading the home...</p>
      </main>
    )
  }

  if (progress.phase === 'failed') {
    return (
      <main className="wrap">
        <p>
          <Link to="/">Back to all homes</Link>
        </p>
        <div role="alert" className="problem">
          <p>{progress.reason}</p>
          <button type="button" onClick={startOver}>
            Try again
          </button>
        </div>
      </main>
    )
  }

  const { homeData, billList, owedList } = progress.payload

  return (
    <main className="wrap">
      <p>
        <Link to="/">Back to all homes</Link>
      </p>
      <h1>{homeData.name}</h1>

      <PeopleBlock homeData={homeData} afterChange={reloadAll} />
      <OwedBlock owedList={owedList} />
      <NewBillBlock
        homeId={homeData.id}
        somebodyLivesHere={homeData.members.length > 0}
        afterChange={reloadAll}
      />
      <BillsBlock homeData={homeData} billList={billList} afterChange={reloadAll} />
    </main>
  )
}

function PeopleBlock(inputs: { homeData: HomeFull; afterChange: () => void }) {
  const [typedName, setTypedName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [formProblem, setFormProblem] = useState<string | null>(null)

  async function handleSubmit(submitted: FormEvent) {
    submitted.preventDefault()
    setIsSaving(true)
    setFormProblem(null)

    try {
      await postMember(inputs.homeData.id, typedName)
      setTypedName('')
      inputs.afterChange()
    } catch (problem) {
      setFormProblem(problem instanceof Error ? problem.message : 'Could not add the member.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section>
      <h2>Members</h2>
      {inputs.homeData.members.length === 0 ? (
        <p className="hint">Nobody lives here yet. Add a member before adding a bill.</p>
      ) : (
        <ol className="plain-list">
          {inputs.homeData.members.map((person) => (
            <li key={person.id}>{person.name}</li>
          ))}
        </ol>
      )}
      <form onSubmit={handleSubmit} className="inline-form">
        <label htmlFor="member-name">Name</label>
        <input
          id="member-name"
          value={typedName}
          onChange={(changed) => setTypedName(changed.target.value)}
          maxLength={100}
          required
        />
        <button type="submit" disabled={isSaving}>
          {isSaving ? 'Adding...' : 'Add member'}
        </button>
      </form>
      {formProblem && (
        <p role="alert" className="problem">
          {formProblem}
        </p>
      )}
    </section>
  )
}

function OwedBlock(inputs: { owedList: Owed[] }) {
  if (inputs.owedList.length === 0) {
    return null
  }

  return (
    <section>
      <h2>Still to pay</h2>
      <table>
        <tbody>
          {inputs.owedList.map((entry) => (
            <tr key={entry.memberId}>
              <td>{entry.name}</td>
              <td className="amt">{showMoney(entry.outstandingCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function NewBillBlock(inputs: {
  homeId: string
  somebodyLivesHere: boolean
  afterChange: () => void
}) {
  const [typedTitle, setTypedTitle] = useState('')
  const [typedAmount, setTypedAmount] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [formProblem, setFormProblem] = useState<string | null>(null)

  async function handleSubmit(submitted: FormEvent) {
    submitted.preventDefault()
    setFormProblem(null)

    const parsedCents = typedToCents(typedAmount)
    if (parsedCents === null) {
      setFormProblem('Write the amount in dollars, like 25 or 25.50. It must be more than 0.')
      return
    }

    setIsSaving(true)
    try {
      await submitBill(inputs.homeId, typedTitle, parsedCents)
      setTypedTitle('')
      setTypedAmount('')
      inputs.afterChange()
    } catch (problem) {
      setFormProblem(problem instanceof Error ? problem.message : 'Could not add the bill.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section>
      <h2>Add a bill</h2>
      <form onSubmit={handleSubmit} className="inline-form">
        <label htmlFor="bill-title">Title</label>
        <input
          id="bill-title"
          value={typedTitle}
          onChange={(changed) => setTypedTitle(changed.target.value)}
          maxLength={100}
          required
        />
        <label htmlFor="bill-amount">Amount ($)</label>
        <input
          id="bill-amount"
          value={typedAmount}
          onChange={(changed) => setTypedAmount(changed.target.value)}
          inputMode="decimal"
          required
        />
        <button type="submit" disabled={isSaving || !inputs.somebodyLivesHere}>
          {isSaving ? 'Adding...' : 'Add bill'}
        </button>
      </form>
      {!inputs.somebodyLivesHere && <p className="hint">Add at least one member first.</p>}
      {formProblem && (
        <p role="alert" className="problem">
          {formProblem}
        </p>
      )}
    </section>
  )
}

function BillsBlock(inputs: { homeData: HomeFull; billList: BillData[]; afterChange: () => void }) {
  const [busyShares, setBusyShares] = useState<Set<string>>(new Set())
  const [shareProblems, setShareProblems] = useState<Record<string, string>>({})

  /*
    One Idempotency-Key for each share. It is made on the first click and kept
    until the payment works. If the first try times out, the second click sends
    the same key, so the server knows it is the same payment and does not
    take the money twice.
  */
  const payKeys = useRef(new Map<string, string>())

  const nameById = new Map(inputs.homeData.members.map((person) => [person.id, person.name]))

  async function handlePay(billId: string, shareId: string) {
    let idemKey = payKeys.current.get(shareId)
    if (!idemKey) {
      idemKey = crypto.randomUUID()
      payKeys.current.set(shareId, idemKey)
    }

    setBusyShares((earlier) => new Set(earlier).add(shareId))
    setShareProblems((earlier) => ({ ...earlier, [shareId]: '' }))

    try {
      await postPayment(billId, shareId, idemKey)
      payKeys.current.delete(shareId)
      inputs.afterChange()
    } catch (problem) {
      const sentence = problem instanceof Error ? problem.message : 'The payment did not work.'
      setShareProblems((earlier) => ({ ...earlier, [shareId]: sentence }))
    } finally {
      setBusyShares((earlier) => {
        const later = new Set(earlier)
        later.delete(shareId)
        return later
      })
    }
  }

  return (
    <section>
      <h2>Bills</h2>
      {inputs.billList.length === 0 && <p className="hint">There are no bills yet.</p>}
      {inputs.billList.map((oneBill) => (
        <article key={oneBill.id} className="bill-card">
          <h3>
            {oneBill.title} <span className="amt">{showMoney(oneBill.totalCents)}</span>
          </h3>
          <ul className="share-lines">
            {oneBill.shares.map((line) => (
              <li key={line.id}>
                <span>{nameById.get(line.memberId) ?? 'Unknown member'}</span>
                <span className="amt">{showMoney(line.amountCents)}</span>
                {line.paidAt ? (
                  <span className="settled">
                    Paid on {new Date(line.paidAt).toLocaleDateString()}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handlePay(oneBill.id, line.id)}
                    disabled={busyShares.has(line.id)}
                  >
                    {busyShares.has(line.id) ? 'Paying...' : 'Pay'}
                  </button>
                )}
                {shareProblems[line.id] && (
                  <span role="alert" className="problem">
                    {shareProblems[line.id]} The share is still unpaid.
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
