import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { createHome, listHomes } from '../api'
import { useLoad } from '../useLoad'

export const Route = createFileRoute('/')({
  component: HomesPage,
})

function HomesPage() {
  const navigate = useNavigate()
  const { state, retry } = useLoad(listHomes)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError(null)

    try {
      const home = await createHome(name)
      await navigate({ to: '/homes/$homeId', params: { homeId: home.id } })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create the home.')
      setSaving(false)
    }
  }

  return (
    <main className="page">
      <h1>Bill splitter</h1>

      <section>
        <h2>Your homes</h2>
        {state.status === 'loading' && <p>Loading homes...</p>}
        {state.status === 'error' && (
          <div role="alert" className="error">
            <p>{state.message}</p>
            <button type="button" onClick={retry}>
              Try again
            </button>
          </div>
        )}
        {state.status === 'ready' && state.data.length === 0 && (
          <p className="empty">There are no homes yet. Add the first one below.</p>
        )}
        {state.status === 'ready' && state.data.length > 0 && (
          <ul className="list">
            {state.data.map((home) => (
              <li key={home.id}>
                <Link to="/homes/$homeId" params={{ homeId: home.id }}>
                  {home.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Add a home</h2>
        <form onSubmit={onSubmit} className="row">
          <label htmlFor="home-name">Name</label>
          <input
            id="home-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            required
          />
          <button type="submit" disabled={saving}>
            {saving ? 'Adding...' : 'Add home'}
          </button>
        </form>
        {formError && (
          <p role="alert" className="error">
            {formError}
          </p>
        )}
      </section>
    </main>
  )
}
