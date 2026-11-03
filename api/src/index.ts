import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { billRoutes } from './routes/bills'
import { homeRoutes } from './routes/homes'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (ctx) => ctx.json({ status: 'ok' }))
app.route('/api/homes', homeRoutes)
app.route('/api/bills', billRoutes)

app.notFound((ctx) => ctx.json({ error: 'No such route' }, 404))

app.onError((failure, ctx) => {
  if (failure instanceof HTTPException) {
    return ctx.json({ error: failure.message }, failure.status)
  }

  console.error(failure)
  return ctx.json({ error: 'Unexpected server error' }, 500)
})

export default app
