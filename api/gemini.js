export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const API_KEY = process.env.GEMINI_API_KEY
  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured' })
  }

  // Support _model parameter: chat uses flash, identify uses flash-lite
  const body = { ...req.body }
  const model = body._model || 'gemini-2.5-flash-lite'
  delete body._model

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await resp.json()
    return res.status(resp.status).json(data)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
