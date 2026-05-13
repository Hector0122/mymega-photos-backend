import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '../prisma.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    })
    if (existing) throw new ConflictException('Email already registered')

    const password = await bcrypt.hash(dto.password, 10)
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        password,
      },
    })

    const token = this.jwt.sign({ sub: user.id })
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    })
    if (!user) throw new UnauthorizedException('Invalid credentials')

    const valid = await bcrypt.compare(dto.password, user.password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    const token = this.jwt.sign({ sub: user.id })
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorizedException()

    if (dto.newPassword) {
      if (!dto.currentPassword) throw new BadRequestException('currentPassword is required to change password')
      const valid = await bcrypt.compare(dto.currentPassword, user.password)
      if (!valid) throw new UnauthorizedException('Current password is incorrect')
    }

    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
      if (existing) throw new ConflictException('Email already in use')
    }

    const data: any = {}
    if (dto.name) data.name = dto.name
    if (dto.email) data.email = dto.email
    if (dto.newPassword) data.password = await bcrypt.hash(dto.newPassword, 10)

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    })

    return { id: updated.id, email: updated.email, name: updated.name }
  }
}
