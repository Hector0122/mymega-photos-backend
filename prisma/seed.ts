import 'dotenv/config'
import pg from 'pg'
import * as bcrypt from 'bcrypt'
import { URL } from 'url'

const dbUrl = new URL(process.env.DATABASE_URL!)
const pool = new pg.Pool({
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port || '5432'),
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password || ''),
  database: dbUrl.pathname.slice(1),
})

async function main() {
  const email = 'demo@vaulta.com'
  const passwordRaw = '123456'
  const name = 'Demo User'

  const { rows } = await pool.query('SELECT id FROM "User" WHERE email = $1', [email])
  if (rows.length > 0) {
    console.log(`User ${email} already exists`)
    return
  }

  const password = await bcrypt.hash(passwordRaw, 10)
  await pool.query(
    'INSERT INTO "User" (id, email, name, password, "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, NOW())',
    [email, name, password],
  )
  console.log(`Default user created — ${email} / ${passwordRaw}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await pool.end()
  })
