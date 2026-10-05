import app from './app.js'

const port = Number(process.env.PORT || 8787)

app.listen(port, '0.0.0.0', () => {
  console.log(`Material Tracking API on http://localhost:${port}`)
})
