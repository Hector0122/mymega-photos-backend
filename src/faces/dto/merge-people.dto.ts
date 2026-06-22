import { IsString, MinLength } from 'class-validator';

export class MergePeopleDto {
  @IsString()
  @MinLength(1)
  fromPerson: string;

  @IsString()
  @MinLength(1)
  toPerson: string;
}
