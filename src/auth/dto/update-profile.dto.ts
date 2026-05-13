import { IsOptional, IsString, MinLength, IsEmail } from 'class-validator'

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string

  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  currentPassword?: string

  @IsOptional()
  @IsString()
  @MinLength(6)
  newPassword?: string
}
