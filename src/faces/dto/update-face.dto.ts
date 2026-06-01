import {
  IsString,
  IsBoolean,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';

export class UpdateFaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  personName?: string;

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  @IsOptional()
  @IsBoolean()
  ignored?: boolean;
}
