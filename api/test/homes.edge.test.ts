import { describe, expect, it } from 'vitest'
import { call, createHome, type Member } from './helpers'
import { countRows, rawPost } from './support'

describe('homes and members: edge cases', () => {
  it('gives every home a different id', async () => {
    const first = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'A' } })
    const second = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'A' } })

    expect(first.body.id).not.toBe(second.body.id)
  })

  it('returns the member with its own id and the home id', async () => {
    const home = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'Flat' } })
    const member = await call<Member>('POST', `/api/homes/${home.body.id}/members`, {
      body: { name: 'Asha' },
    })

    expect(member.body).toEqual({ id: expect.any(String), homeId: home.body.id, name: 'Asha' })
  })

  it.each([
    ['missing', {}],
    ['empty', { name: '' }],
    ['blank', { name: '   ' }],
    ['a number', { name: 42 }],
    ['null', { name: null }],
    ['an array', { name: ['Flat'] }],
  ])('rejects a home name that is %s with 422', async (_, body) => {
    const before = await countRows('homes')

    const response = await call<{ error: string }>('POST', '/api/homes', { body })

    expect(response.status).toBe(422)
    expect(response.body.error).toEqual(expect.any(String))
    expect(await countRows('homes')).toBe(before)
  })

  it.each([
    ['empty', { name: '' }],
    ['blank', { name: '  ' }],
    ['missing', {}],
    ['a boolean', { name: true }],
  ])('rejects a member name that is %s with 422', async (_, body) => {
    const { homeId } = await createHome([])
    const before = await countRows('members')

    const response = await call('POST', `/api/homes/${homeId}/members`, { body })

    expect(response.status).toBe(422)
    expect(await countRows('members')).toBe(before)
  })

  it('answers malformed JSON with 400 and a JSON error', async () => {
    const response = await rawPost('/api/homes', '{"name": ')

    expect(response.status).toBe(400)
    expect(response.contentType).toContain('application/json')
    expect(JSON.parse(response.text)).toEqual({ error: expect.any(String) })
  })

  it('answers malformed JSON on the members route with 400', async () => {
    const { homeId } = await createHome([])

    const response = await rawPost(`/api/homes/${homeId}/members`, '{name: Asha}')

    expect(response.status).toBe(400)
    expect(JSON.parse(response.text)).toEqual({ error: expect.any(String) })
  })

  it.each(['[]', '"Flat"', 'null', '42'])(
    'rejects the non-object body %s with 400',
    async (body) => {
      const response = await rawPost('/api/homes', body)

      expect(response.status).toBe(400)
    },
  )

  it('does not depend on the content-type header for a valid JSON body', async () => {
    const response = await rawPost('/api/homes', '{"name":"Flat"}', 'text/plain')

    expect(response.status).toBe(201)
  })

  it('trims surrounding spaces from names', async () => {
    const home = await call<{ name: string }>('POST', '/api/homes', {
      body: { name: '  Flat 4B ' },
    })

    expect(home.body.name).toBe('Flat 4B')
  })

  it('allows two members with the same name', async () => {
    const { members } = await createHome(['Asha', 'Asha'])

    expect(members).toHaveLength(2)
    expect(members[0]?.id).not.toBe(members[1]?.id)
  })

  it('keeps 15 members in the order they were added', async () => {
    const names = Array.from({ length: 15 }, (_, index) => `Member ${index}`)
    const { homeId, members } = await createHome(names)

    const balances = await call<{ balances: { memberId: string; name: string }[] }>(
      'GET',
      `/api/homes/${homeId}/balances`,
    )

    expect(balances.body.balances.map((b) => b.memberId)).toEqual(members.map((m) => m.id))
    expect(balances.body.balances.map((b) => b.name)).toEqual(names)
  })

  it('stores every member when many are added at the same time', async () => {
    const { homeId } = await createHome([])
    const names = Array.from({ length: 20 }, (_, index) => `Member ${index}`)

    const created = await Promise.all(
      names.map((name) => call<Member>('POST', `/api/homes/${homeId}/members`, { body: { name } })),
    )
    const balances = await call<{ balances: { memberId: string }[] }>(
      'GET',
      `/api/homes/${homeId}/balances`,
    )

    expect(created.every((response) => response.status === 201)).toBe(true)
    expect(new Set(balances.body.balances.map((b) => b.memberId))).toEqual(
      new Set(created.map((response) => response.body.id)),
    )
  })

  it('keeps members of different homes apart', async () => {
    const first = await createHome(['Asha', 'Ben'])
    const second = await createHome(['Asha'])

    const balances = await call<{ balances: { memberId: string }[] }>(
      'GET',
      `/api/homes/${second.homeId}/balances`,
    )

    expect(balances.body.balances.map((b) => b.memberId)).toEqual([second.members[0]?.id])
    expect(first.members).toHaveLength(2)
  })

  it('lists homes in the order they were created', async () => {
    const a = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'List A' } })
    const b = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'List B' } })

    const list = await call<{ homes: { id: string }[] }>('GET', '/api/homes')
    const ids = list.body.homes.map((home) => home.id)

    expect(ids.indexOf(a.body.id)).toBeLessThan(ids.indexOf(b.body.id))
  })
})

describe('API errors', () => {
  it('answers an unknown route with a JSON 404', async () => {
    const response = await call('GET', '/api/nothing-here')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: expect.any(String) })
  })

  it('answers a wrong method with a JSON 404', async () => {
    const response = await call('GET', '/api/homes/x/members')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: expect.any(String) })
  })

  it('still answers the health check', async () => {
    const response = await call('GET', '/api/health')

    expect(response).toEqual({ status: 200, body: { status: 'ok' } })
  })

  it('treats a SQL-looking id as a plain value', async () => {
    const response = await call(
      'POST',
      `/api/homes/${encodeURIComponent("x' OR '1'='1")}/members`,
      {
        body: { name: 'Asha' },
      },
    )

    expect(response.status).toBe(404)
  })
})
