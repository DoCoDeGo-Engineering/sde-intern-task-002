import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api, type Home, useFormAction } from '../api'

export const Route = createFileRoute('/')({
  component: CreateHome,
})

function CreateHome() {
  const navigate = useNavigate()
  const [error, create, creating] = useFormAction(async (form) => {
    const home = await api<Home>('/api/homes', { method: 'POST', body: { name: form.get('name') } })
    await navigate({ to: '/homes/$homeId', params: { homeId: home.id } })
  })

  return (
    <main>
      <h1>Bill Splitter</h1>
      <form action={create} className="row">
        <label>
          Home name <input name="name" required maxLength={100} placeholder="Flat 4B" />
        </label>
        <button type="submit" disabled={creating}>
          {creating ? 'Creating…' : 'Create home'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
