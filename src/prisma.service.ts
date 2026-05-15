import { Injectable, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcrypt'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is required')
    const adapter = new PrismaPg(
      { connectionString },
      { schema: process.env.DATABASE_SCHEMA || 'public' },
    )
    super({ adapter })
  }

  async onModuleInit() {
    await this.$connect()
    await this.seedDefaultUser()
  }

  private async seedDefaultUser() {
    const email = process.env.DEMO_EMAIL || 'demo@mymega.com'
    const passwordRaw = process.env.DEMO_PASSWORD || '123456'
    const name = process.env.DEMO_NAME || 'Demo User'

    const exists = await this.user.findUnique({
      where: { email },
    })
    if (exists) return

    const password = await bcrypt.hash(passwordRaw, 10)
    await this.user.create({
      data: { email, name, password },
    })
    console.log(`Default user created — ${email} / ${passwordRaw}`)
  }
}
