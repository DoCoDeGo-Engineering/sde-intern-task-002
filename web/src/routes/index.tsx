import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { loadHomes, postHome } from '../server'
import { useAsync } from '../useAsync'

export const Route = createFileRoute('/')({
  component: HomeListScreen,
})

function HomeListScreen() {
  const goTo = useNavigate()
  const { progress, startOver } = useAsync(loadHomes)
  const [typedName, setTypedName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [formProblem, setFormProblem] = useState<string | null>(null)

  async function handleSubmit(submitted: FormEvent) {
    submitted.preventDefault()
    setIsSaving(true)
    setFormProblem(null)

    try {
      const made = await postHome(typedName)
      await goTo({ to: '/home/$homeId', params: { homeId: made.id } })
    } catch (problem) {
      setFormProblem(problem instanceof Error ? problem.message : 'Could not create the home.')
      setIsSaving(false)
    }
  }

  return (
    <main className="wrap">
      <h1>Bill splitter</h1>

      <section>
        <h2>Your homes</h2>
        {progress.phase === 'loading' && <p>Loading homes...</p>}
        {progress.phase === 'failed' && (
          <div role="alert" className="problem">
            <p>{progress.reason}</p>
            <button type="button" onClick={startOver}>
              Try again
            </button>
          </div>
        )}
        {progress.phase === 'ready' && progress.payload.length === 0 && (
          <p className="hint">There are no homes yet. Add the first one below.</p>
        )}
        {progress.phase === 'ready' && progress.payload.length > 0 && (
          <ul className="plain-list">
            {progress.payload.map((entry) => (
              <li key={entry.id}>
                <Link to="/home/$homeId" params={{ homeId: entry.id }}>
                  {entry.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Add a home</h2>
        <form onSubmit={handleSubmit} className="inline-form">
          <label htmlFor="home-name">Name</label>
          <input
            id="home-name"
            value={typedName}
            onChange={(changed) => setTypedName(changed.target.value)}
            maxLength={100}
            required
          />
          <button type="submit" disabled={isSaving}>
            {isSaving ? 'Adding...' : 'Add home'}
          </button>
        </form>
        {formProblem && (
          <p role="alert" className="problem">
            {formProblem}
          </p>
        )}
      </section>
    </main>
  )
}
